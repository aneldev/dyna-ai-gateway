# Chat files and their storage

A user can attach images and PDFs to a question: a screenshot of an error, a photo of a receipt, an invoice as PDF. The
application uploads the file once and gets a pointer back. The question carries the pointer, and the gateway loads the
bytes for the model. The bytes live in the host's blob storage only. The thread, the trace and a paused run keep the
pointer.

## 1. About

| Piece                                                                   | What it is                                                           | Who provides it                   |
|-------------------------------------------------------------------------|----------------------------------------------------------------------|-----------------------------------|
| [`IFileRef`](../30-api/index/interfaces/IFileRef.md)                    | the file pointer: `id`, `tenantId`, `userId`, `mime`, `size`, `name` | `uploadFile` returns it           |
| `FileStore`                                                             | stores, reads, signs and deletes the files of a tenant's users       | the gateway, from `fileStore`     |
| [`IBlobAdapter`](../30-api/index/interfaces/IBlobAdapter.md)            | the blob storage behind the `FileStore`: five methods on keys        | the host (S3, Azure Blob, GCS, …) |
| [`InMemoryBlobAdapter`](../30-api/index/classes/InMemoryBlobAdapter.md) | an `IBlobAdapter` in a `Map`, for tests and the first run            | the package                       |
| [`IModelCaps`](../30-api/index/interfaces/IModelCaps.md)                | `images` and `pdf` say which files a model reads                     | the model registry                |

The methods the application calls:

| Method                                | What it does                                                          | Caller                    |
|---------------------------------------|-----------------------------------------------------------------------|---------------------------|
| `uploadFile`                          | stores the bytes in the calling user's folder, returns the `IFileRef` | the host's upload route   |
| `deleteFile`                          | removes one file of the calling user                                  | "remove attachment"       |
| `getFileUrl`                          | a short-lived signed URL of one file of the calling user              | the chat screen           |
| `removeFilesByUser`                   | removes every file of one user, returns the count                     | an admin surface          |
| `delete`                              | removes threads, and the files their turns point at                   | "delete conversation"     |
| `deleteUserData`, `anonymizeUserData` | "forget this user": the files go in both                              | an erasure request (GDPR) |

The gateway keeps no list of files: a file is its pointer
([D30](../60-architecture/90-decisions.md#d30-a-file-is-its-pointer)).

## 2. Logic

### 2.1 Upload

`uploadFile({userContext, bytes, mime, name})` checks the file, then writes it through the adapter under the key
`<tenantId>/<path>/<userId>/<fileId>`. The id is a new UUID. `path` is `fileStore.path`: any number of folders, or an
empty string.

| Check                                                        | Status | Error `data`          |
|--------------------------------------------------------------|--------|-----------------------|
| `mime` is in `fileStore.allowedMime`                         | 400    | `mime`, `allowedMime` |
| `name` is at most 255 characters, without control characters | 400    | `length`, `maxChars`  |
| the file is not empty                                        | 400    | `size`, `maxBytes`    |
| the file is at most `fileStore.maxBytes`                     | 413    | `size`, `maxBytes`    |
| the user is not being erased                                 | 409    |                       |

The default types are PNG, JPEG, WebP, GIF and PDF, named one by one. `image/*` in `allowedMime` allows every image
subtype, `image/svg+xml` included. The default `maxBytes` is 20 MB.

The tenant id, the user id and every folder of `path` are used as folder names. An empty one, one with `/` or `\`, `.`
and `..` are a 400 before the adapter is reached. A file id is letters, digits, `_` and `-` only.

### 2.2 A question with files

`files` of [`ask()`](../30-api/index/interfaces/IGatewayAskInput.md) and
[`run()`](../30-api/index/interfaces/IGatewayRunInput.md) takes the pointers `uploadFile` returned.

1. The gateway checks every pointer before it reads anything. A pointer of another tenant or of another user is a 400.
2. It reads the bytes through the adapter. A file that is not there is a 404.
3. The input rules run. Their judge can send the files to a model (chapter 2.5).
4. The user turn is stored with one `FILE` part per file: the pointer, never the bytes.
5. The files the model can read go into the message of the question, after its text. A question without text is a
   message of files only: the built-in rule `prompt_not_empty` passes when files come with the prompt.

A refusal in steps 1 and 2 happens before anything is stored, so no thread and no turn is created.

The bytes reach the model for this question only. The next question of the thread sends the pointers of earlier turns to
no model. A question about an earlier file passes it again
([D31](../60-architecture/90-decisions.md#d31-only-the-files-of-the-current-question-go-to-the-model)).

### 2.3 Which models read which files

| Type              | The model needs   |
|-------------------|-------------------|
| `image/*`         | `caps.images`     |
| `application/pdf` | `caps.pdf`        |
| any other type    | no model reads it |

A file the model cannot read is left out of the request. The response carries the WARNING issue `file_dropped`, one per
file, and the question is still answered from its text. The thread keeps the pointer. A type that `allowedMime` accepts
but no model reads is therefore uploaded, stored and dropped on every call.

The caps are data of the model. See [Models and profiles](010-models-and-profiles.md).

### 2.4 Tokens and cost

The usage guard's estimate counts a file from its header: an image by its width and height, a PDF at 2 000 tokens per
page, an unreadable header at a flat 1 600. The thread's window is trimmed before the files are added, so files do not push
older turns out. A `run()` keeps the files in the question's message, so every model step of the run carries them.

### 2.5 The files in the guardrails

An input rule gets the pointers in `evidence.files` and the bytes in `evidence.inlineFiles`, in the same order. Its
`judge` sends the prompt and the files its `fileFilter` picks
([D57, D59](../60-architecture/90-decisions.md#d57-d59-a-rule-gets-a-judge)). `fileFilter: () => false` sends none. See
[Guardrails](050-guardrails.md).

### 2.6 Where the bytes are, and where they are not

| Place                                          | What it keeps of a file                             |
|------------------------------------------------|-----------------------------------------------------|
| the blob storage                               | the bytes and the media type, the only copy         |
| the thread's user turn                         | the `IFileRef` in a `FILE` part                     |
| a trace entry                                  | name, type, file id and size, empty bytes           |
| a paused run                                   | name, type, file id and size, empty bytes           |
| the thread summary, the user-memory extraction | one line `[file <name>, <mime>]`, never the content |

A resume loads the bytes again under the user who asked, also when another user resumes. A file deleted while the run
waited reaches the model as the text `[The file <name> (<mime>) was deleted and is no longer available]`, and the run goes
on ([D108](../60-architecture/90-decisions.md#d108-the-bytes-of-a-file-live-in-the-filestore-only)).

### 2.7 Who may read a file

A file is its uploader's. The key holds the tenant as its first folder and the user as its last one, and every method of
the facade builds the key from `userContext`.

| Call                          | Another user's file                                   |
|-------------------------------|-------------------------------------------------------|
| `ask`, `run` with the pointer | 400 (`data.fileId`), nothing stored                   |
| `getFileUrl`                  | the adapter's 404                                     |
| `deleteFile`                  | nothing happens: the caller's folder has no such file |
| `removeFilesByUser`           | raw ids, no user check: an admin surface              |

The same rule in the overview of every check:
[Who may read a thread, a file or a paused run?](../10-getting-started/90-faq.md#who-may-read-a-thread-a-file-or-a-paused-run).

### 2.8 Lifecycle and deletion

| Event                                 | The blob                                                   | The pointers in the turns |
|---------------------------------------|------------------------------------------------------------|---------------------------|
| `uploadFile`                          | written                                                    | none yet                  |
| `ask` / `run` with the file           | read for the model                                         | stored in the user turn   |
| `deleteFile`                          | removed                                                    | kept                      |
| `delete` of the thread                | removed, for the thread owner's files its turns point at   | removed with the turns    |
| `removeFilesByUser`                   | every file of the user removed                             | kept                      |
| `deleteUserData`, `anonymizeUserData` | every file of the user removed (`IForgetUserResult.files`) | removed                   |

There is no expiry. A file that no question carried stays until `deleteFile`, `removeFilesByUser` or the erasure of its
user: `delete` finds files through the turns only. After a file is removed, a question with its pointer and `getFileUrl`
are a 404.

`delete` is described in [How do I delete conversations?](../10-getting-started/90-faq.md#how-do-i-delete-conversations),
the erasure in [D54](../60-architecture/90-decisions.md#d54-forgetting-a-user-is-two-methods) and
[D114](../60-architecture/90-decisions.md#d114-the-erasure-keeps-the-users-calls-out).

### 2.9 The blob adapter

The `FileStore` reaches the storage through five methods of `IBlobAdapter`:

| Method           | Contract                                                                 |
|------------------|--------------------------------------------------------------------------|
| `put`            | stores the bytes and the `mime` under the key, replacing what was there  |
| `get`            | returns the bytes; a missing key throws an error with `status: 404`      |
| `signedUrl`      | a URL valid for `ttlSec` seconds; a missing key throws `status: 404`     |
| `remove`         | deletes one key; a missing key changes nothing                           |
| `removeByPrefix` | deletes every key under the prefix (it ends with `/`), returns the count |

The 404 is part of the contract: a resume turns it into the "deleted" note, and any other error fails the call.
`InMemoryBlobAdapter` keeps everything in the process and returns `in-memory://` URLs that no browser opens. The real
adapters are not shipped yet ([Known limits](../60-architecture/10-architecture-and-trade-offs.md#6-known-limits)).

## 3. Examples

The `config` and the `userContext` are those of [Installation](../10-getting-started/20-installation.md) and
[Example: ask](../10-getting-started/30-example-ask.md). The `accounting` profile runs on `gpt-5-mini`, whose caps have
`images: true` and `pdf: true`.

### 3.1 Upload, then ask

The upload is the host's own route. The chat call sends the pointer.

```ts
import {AIGateway, EGatewayResponseKind, IFileRef} from "dyna-ai-gateway";

const gateway = new AIGateway(config);

// The host's upload route: multipart form data with one "file" field
const uploadRoute = async (request: Request): Promise<IFileRef> => {
  const form = await request.formData();
  const upload = form.get("file");
  if (!(upload instanceof File)) throw new Error("No file in the request");
  return gateway.uploadFile({
    userContext,
    bytes: new Uint8Array(await upload.arrayBuffer()),
    mime: upload.type,
    name: upload.name,
  });
};

const invoice = await uploadRoute(request); // the client keeps the IFileRef and sends it with the question

const {response} = gateway.ask({
  userContext,
  profileId: "accounting",
  prompt: "Which lines of this invoice are missing a VAT code?",
  files: [invoice],
  kbFilters: {libraryIds: [], bookIds: []},
});

const result = await response;
if (result.kind === EGatewayResponseKind.ANSWER) {
  const dropped = result.issues.filter(issue => issue.code === "file_dropped");
  // Not empty on a model without caps.pdf: the answer came from the text alone
}
```

### 3.2 A follow-up about the same file

The pointer of the first question is in the thread, the bytes are not sent again. A question that needs the file passes it
again.

```ts
const first = await gateway.ask({
  userContext,
  profileId: "accounting",
  prompt: "Which lines of this invoice are missing a VAT code?",
  files: [invoice],
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

const followUp = await gateway.ask({
  userContext,
  profileId: "accounting",
  threadId: first.threadId,
  prompt: "And what is the total without VAT?",
  files: [invoice], // without it, the model reads only the earlier answer
  kbFilters: {libraryIds: [], bookIds: []},
}).response;
```

### 3.3 Show the files of a thread

`getTurns` returns the pointers. `getFileUrl` signs one for the browser, which fetches the bytes from the storage.

```ts
import {EPartKind} from "dyna-ai-gateway";

const turns = await gateway.getTurns({userContext, threadId}); // the id of the thread the user opened
const attachments = await Promise.all(
  turns.flatMap(turn => turn.parts).flatMap(part => part.kind === EPartKind.FILE
    ? [gateway.getFileUrl({userContext, fileId: part.file.id, ttlSec: 300}).then(url => ({name: part.file.name, url}))]
    : []),
);
```

The [Vercel chat client](../10-getting-started/50-vercel-chat-client.md#5-files) module does the same through its
`files.toUrl` hook.

### 3.4 The caps of the store

```ts
import {AIGateway} from "dyna-ai-gateway";

const gateway = new AIGateway({
  ...config,
  fileStore: {
    adapter: config.fileStore.adapter,
    path: "apps/crm/ai-files",         // keys: <tenantId>/apps/crm/ai-files/<userId>/<fileId>
    maxBytes: 5 * 1024 * 1024,         // a larger upload is a 413
    allowedMime: ["application/pdf"],  // a document assistant: no images
  },
});
```

### 3.5 A refused upload

```ts
const getStatus = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;

try {
  await gateway.uploadFile({userContext, bytes, mime: "image/svg+xml", name: "logo.svg"});
} catch (error) {
  // 400: the type, the name or an empty file; 413: over maxBytes; 409: the user is being erased
  const status = getStatus(error);
}
```

### 3.6 Screen images before the model sees them

The rule's judge sends the prompt and the images of the question to the profile's cheap model.

```ts
import {AIGateway} from "dyna-ai-gateway";

const gateway = new AIGateway({
  ...config,
  guardrails: {
    inputRules: [
      {
        name: "image_moderation",
        check: async ({evidence, judge}) => evidence.files.some(file => file.mime.startsWith("image/"))
          ? judge({
            instruction: "Does an image show violence, nudity or a personal identity document?",
            fileFilter: file => file.mime.startsWith("image/"),
          })
          : [],
      },
    ],
  },
});
```

A question without images costs no judge call. A rule that returns an ERROR rejects the question before anything is
stored.

### 3.7 A blob adapter of your own

A sketch on the AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`). Every missing key becomes an error
with `status: 404`.

```ts
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {IBlobAdapter} from "dyna-ai-gateway";

const notFound = (key: string): Error => Object.assign(new Error(`Blob not found [${key}]`), {status: 404});
const isMissing = (error: unknown): boolean =>
  error instanceof S3ServiceException && (error.name === "NoSuchKey" || error.name === "NotFound");

export class S3BlobAdapter implements IBlobAdapter {
  constructor(private readonly s3: S3Client, private readonly bucket: string) {}

  public async put({key, bytes, mime}: {key: string; bytes: Uint8Array; mime: string}): Promise<void> {
    await this.s3.send(new PutObjectCommand({Bucket: this.bucket, Key: key, Body: bytes, ContentType: mime}));
  }

  public async get({key}: {key: string}): Promise<Uint8Array> {
    try {
      const {Body} = await this.s3.send(new GetObjectCommand({Bucket: this.bucket, Key: key}));
      if (!Body) throw notFound(key);
      return await Body.transformToByteArray();
    } catch (error) {
      throw isMissing(error) ? notFound(key) : error;
    }
  }

  public async signedUrl({key, ttlSec}: {key: string; ttlSec: number}): Promise<string> {
    try {
      await this.s3.send(new HeadObjectCommand({Bucket: this.bucket, Key: key}));
    } catch (error) {
      throw isMissing(error) ? notFound(key) : error;
    }
    return getSignedUrl(this.s3, new GetObjectCommand({Bucket: this.bucket, Key: key}), {expiresIn: ttlSec});
  }

  public async remove({key}: {key: string}): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({Bucket: this.bucket, Key: key}));
  }

  public async removeByPrefix({prefix}: {prefix: string}): Promise<number> {
    let removed = 0;
    let token: string | undefined;
    do {
      const page = await this.s3.send(new ListObjectsV2Command({Bucket: this.bucket, Prefix: prefix, ContinuationToken: token}));
      const objects = (page.Contents ?? []).flatMap(object => object.Key ? [{Key: object.Key}] : []);
      if (objects.length) {
        await this.s3.send(new DeleteObjectsCommand({Bucket: this.bucket, Delete: {Objects: objects}}));
        removed += objects.length;
      }
      token = page.NextContinuationToken;
    } while (token);
    return removed;
  }
}

const gateway = new AIGateway({
  ...config,
  fileStore: {adapter: new S3BlobAdapter(new S3Client({region: "eu-central-1"}), "acme-ai-files"), path: "ai-files"},
});
```

### 3.8 Delete files

```ts
// "Remove attachment" before the message is sent
await gateway.deleteFile({userContext, fileId: invoice.id});

// "Delete conversation": the thread and the owner's files its turns point at
await gateway.delete({tenantId: userContext.tenantId, threadIds: [threadId], userId: userContext.userId});

// Only the uploads of a user, the conversations stay (their turns keep the pointers)
const files = await gateway.removeFilesByUser({tenantId: "acme", userId: "u-17"});

// "Forget this user": files, facts, threads, runs, trace entries
const erased = await gateway.deleteUserData({tenantId: "acme", userId: "u-17"});
erased.files; // the number of files deleted
```

## 4. Pitfalls

- **Trusting the pointer's `userId`.** The client sends the pointer, and the gateway refuses any pointer that is not the
  caller's. Pass the `userContext` the host authenticated, never one taken from the request
  ([What the gateway trusts](../60-architecture/10-architecture-and-trade-offs.md#52-what-the-gateway-trusts)).
- **Trusting the `mime`.** The declared type is not compared with the bytes
  ([What no check covers](../60-architecture/10-architecture-and-trade-offs.md#53-what-no-check-covers)). Check the
  bytes in the upload route when it matters.
- **Allowing SVG.** `image/*` allows `image/svg+xml`, which can carry a script. Allow it only when the files are never
  shown inline from an origin the app trusts.
- **Allowing a type no model reads.** A text file or a spreadsheet uploads fine and is dropped with `file_dropped` on
  every call. Only images and PDFs reach a model.
- **A profile on a model without the caps.** A question with a PDF on a model without `caps.pdf` is answered without the
  PDF. Read the `file_dropped` issue and tell the user.
- **Expecting the model to remember a file.** Earlier files are not sent again. A follow-up that needs the file passes it
  again.
- **Large files on a run.** Every step of a `run()` carries the files, and the thread's window does not make room for
  them. Size `maxBytes` for what the models take.
- **An adapter without the 404.** A `get` that throws something else for a missing key fails a resume whose file was
  deleted, instead of sending the "deleted" note.
- **The in-memory adapter in production.** Nothing survives the process, nothing is shared between processes, and its
  URLs open nowhere.
- **Counting on `delete` for every file.** `delete` removes the files the turns point at. An upload that no question
  carried stays; remove it with `deleteFile` when the user drops the attachment.
- **A storage rule that deletes old files.** The gateway does not see it: a later question with the pointer is a 404,
  and a paused run resumes with the "deleted" note.

## 5. Summary

- `uploadFile` stores the bytes at `<tenantId>/<path>/<userId>/<fileId>` and returns an `IFileRef`. The question passes
  the pointer in `files`.
- A question may carry only the caller's own files. Another tenant's or user's pointer is a 400, a missing file a 404,
  both before anything is stored.
- Images need `caps.images`, PDFs `caps.pdf`. Any other file is left out with the WARNING `file_dropped`.
- Only the files of the current question reach the model. The thread, the trace and a paused run keep no bytes.
- Files go with `deleteFile`, with their thread (`delete`), with `removeFilesByUser` and with the erasure of the user.
  There is no expiry.
- The host provides the storage as an `IBlobAdapter`. Its `get` and `signedUrl` throw `status: 404` for a missing key.

## 6. FAQ

**Can a user send a file without text?**
Yes. The built-in rule `prompt_not_empty` passes when files come with the prompt, and the files are a message of their
own.

**Does the thread memory or the user memory read the files?**
No. The summary and the fact extraction see one line with the file's name and type. See
[Thread memory](080-thread-memory.md) and [User memory](090-user-memory.md).

**Can a reviewer or an approver see the file of a paused run?**
The model of the resumed step sees it: a resume loads the file under the asker, whoever resumes. `getFileUrl` signs only
the caller's own files, so it gives the reviewer no URL of the asker's file.

**What does a resumed run see when its file was deleted?**
The text `[The file <name> (<mime>) was deleted and is no longer available]` in place of the file. The run goes on.

**Can I replace the `FileStore` itself?**
Yes. `IAIGatewayOverrides.fileStore` is a factory that receives `IFileStoreConfig` and returns an `IFileStore`. Replacing
the adapter is enough for another storage.

**Files or the knowledge base?**
A file is read by the model for one question. Documents the model should search across questions and users belong in the
knowledge base. See [Knowledge base](070-knowledge-base.md).

## 7. API reference

| Symbol                                                                                  | What it is                                                     |
|-----------------------------------------------------------------------------------------|----------------------------------------------------------------|
| [`IFileRef`](../30-api/index/interfaces/IFileRef.md)                                    | the file pointer                                               |
| [`IFilePart`](../30-api/index/interfaces/IFilePart.md)                                  | the pointer in a stored turn                                   |
| [`IInlineFilePart`](../30-api/index/interfaces/IInlineFilePart.md)                      | the bytes in the model's message; empty bytes in trace and run |
| [`IGatewayAskInput.files`](../30-api/index/interfaces/IGatewayAskInput.md)              | the files of a question, `ask()` and `run()`                   |
| [`AIGateway.uploadFile`](../30-api/index/classes/AIGateway.md#uploadfile)               | stores an upload                                               |
| [`AIGateway.getFileUrl`](../30-api/index/classes/AIGateway.md#getfileurl)               | a signed URL of the caller's file                              |
| [`AIGateway.deleteFile`](../30-api/index/classes/AIGateway.md#deletefile)               | removes one file of the caller                                 |
| [`AIGateway.removeFilesByUser`](../30-api/index/classes/AIGateway.md#removefilesbyuser) | removes every file of a user                                   |
| [`AIGateway.deleteUserData`](../30-api/index/classes/AIGateway.md#deleteuserdata)       | "forget this user" by erasure                                  |
| [`AIGateway.anonymizeUserData`](../30-api/index/classes/AIGateway.md#anonymizeuserdata) | "forget this user" by pseudonymisation                         |
| [`IForgetUserResult`](../30-api/index/interfaces/IForgetUserResult.md)                  | the counts of an erasure, `files` among them                   |
| [`IAIGatewayConfig.fileStore`](../30-api/index/interfaces/IAIGatewayConfig.md)          | the store's config                                             |
| [`IFileStoreConfig`](../30-api/index/interfaces/IFileStoreConfig.md)                    | `adapter`, `path`, `maxBytes`, `allowedMime`                   |
| [`IBlobAdapter`](../30-api/index/interfaces/IBlobAdapter.md)                            | the storage the host implements                                |
| [`InMemoryBlobAdapter`](../30-api/index/classes/InMemoryBlobAdapter.md)                 | the adapter for tests and the first run                        |
| [`IModelCaps`](../30-api/index/interfaces/IModelCaps.md)                                | `images`, `pdf`                                                |
| [`IInputJudgeArgs`](../30-api/index/interfaces/IInputJudgeArgs.md)                      | `fileFilter` of an input rule's judge                          |
| [`IFileStore`](../30-api/index/interfaces/IFileStore.md)                                | the contract to pass in `overrides` to replace the store       |
| [`IAIGatewayOverrides`](../30-api/index/interfaces/IAIGatewayOverrides.md)              | `fileStore`, the factory of a replacement                      |

// What the samples of the docs take as given: the objects of Getting started, and the application's own code.
import {
  AIGateway, IAIGatewayConfig, IAIProfileRepository, IBlobAdapter, IInputRule, IModelInfo, IOutputRule, IChunkFilters, IFileRef, IModelRegistryRepository,
  IPromptTemplateRepository, IRunRepository, IThreadRepository, IToolDef, ITraceRepository, IUsage, IUsageAdapter,
  IUserAnswer, IUserContext, IUserMemoryRepository, IUserQuestions, IVectorIndexAdapter, TGatewayResponse,
} from "dyna-ai-gateway";

interface IInvoice {invoiceNo: string; customerName: string; totalCents: number; currency: string; paidAt: Date | null}

declare global {
  const config: IAIGatewayConfig;      // Installation
  const gateway: AIGateway;            // Installation
  const userContext: IUserContext;     // Example: ask
  const approverContext: IUserContext; // Example: a human in the loop
  const kbFilters: IChunkFilters;
  const getInvoice: IToolDef<{invoiceNo: string}, IInvoice | null>;
  const postCreditNote: IToolDef<{invoiceNo: string; amount: number; reason: string}, {creditNoteNo: string}>;
  // ids your screen holds
  const threadId: string;
  const runId: string;
  const pauseId: string;
  const tenantIds: string[];
  const invoice: IInvoice;
  const request: Request;
  const pdf: IFileRef;
  const photo: IFileRef;
  const invoicePdf: IFileRef;
  const deliveryNotePdf: IFileRef;
  const db: unknown;
  const message: string;
  const text: string;
  const attachments: IFileRef[];
  const ticket: {body: string; customerTier: string; openTickets: number};
  const report: {text: string};
  const email: {from: string; subject: string; body: string; order: string};
  const product: object;
  const formValues: Record<string, string>;
  const getOrder: IToolDef<{orderNo: string}, object>;
  // the models of Installation
  const gpt5Mini: IModelInfo;
  const textEmbedding3Small: IModelInfo;
  // the names a page's 8.0 configuration takes from its later examples
  const classifyIntent: IToolDef<{intent: string}, {intent: string}>;
  const handOver: IToolDef<{reason: string}, {ticketId: string; accepted: boolean}>;
  const sendEmail: IToolDef<{invoiceNo: string; subject: string; body: string}, {messageId: string}>;
  const submitDamageReport: IToolDef<object, {claimNo: string}>;
  const fetchStatement: IToolDef<object, object>;
  const matchPayment: IToolDef<object, object>;
  const fileReport: IToolDef<object, object>;
  const noPaymentData: IInputRule;
  const accountingScope: IInputRule;
  const imageModeration: IInputRule;
  const noIdDocuments: IInputRule;
  const noSystemPrompt: IOutputRule;
  const grounding: IOutputRule;
  const noDiscountPromises: IOutputRule;
  const editor: {setDraft(text: string): void; append(text: string): void};
  const queues: {orderBot(text: string): Promise<void>; refunds(text: string): Promise<void>; humans(text: string): Promise<void>};
  const claims: {create(tenantId: string, form: object): Promise<{claimNo: string}>};
  function renderCard(form: IUserQuestions): Promise<IUserAnswer[]>;
  const bank: {statement(accountId: string, signal: AbortSignal): Promise<{lines: object[]}>};
  const reports: {file(tenantId: string, report: object): Promise<{reportId: string}>};
  const notify: {approvers(args: {runId: string; pauseId: string}): Promise<void>};
  const socket: {send(message: object): void};
  function sessionOf(request: Request): Promise<IUserContext>;
  const s3: unknown;
  const bookkeeping: {saveDraft(fields: object): Promise<void>};
  const budgets: {
    tokensLeft(tenantId: string): Promise<number>;
    record(args: {tenantId: string; traceId: string; usage: IUsage; costUsd: number}): Promise<void>;
  };
  const MyModelRegistryRepository: new (db: unknown) => IModelRegistryRepository;
  const MyAIProfileRepository: new (db: unknown) => IAIProfileRepository;
  const MyPromptTemplateRepository: new (db: unknown) => IPromptTemplateRepository;
  const MyThreadRepository: new (db: unknown) => IThreadRepository;
  const MyRunRepository: new (db: unknown) => IRunRepository;
  const MyUserMemoryRepository: new (db: unknown) => IUserMemoryRepository;
  const MyTraceRepository: new (db: unknown) => ITraceRepository;
  const MyBlobAdapter: new (s3: unknown) => IBlobAdapter;
  const MyVectorIndexAdapter: new (db: unknown) => IVectorIndexAdapter;
  const MyUsageAdapter: new (db: unknown) => IUsageAdapter;
  const paused: TGatewayResponse;
  function answersFrom(form: IUserQuestions): IUserAnswer[];
  // your application's code
  function showToUser(text: string): void;
  function showProgress(text: string): void;
  const invoices: {load(tenantId: string, invoiceNo: string): Promise<IInvoice | null>};
  const ledger: {
    isLargeAmount(bankLineId: string): Promise<boolean>;
    match(tenantId: string, input: {bankLineId: string; invoiceNo: string}): Promise<{matched: boolean}>;
    isPeriodClosed(args: {invoiceNo: string}): Promise<boolean>;
    postCreditNote(tenantId: string, input: {invoiceNo: string; amount: number; reason: string}): Promise<{creditNoteNo: string}>;
  };
  const drafts: {replaceText(args: {tenantId: string; draftId: string; text: string}): Promise<{saved: boolean}>};
  const tickets: {open(reason: string): Promise<{ticketId: string; accepted: boolean}>};
  const mailer: {send(tenantId: string, mail: {invoiceNo: string; subject: string; body: string}): Promise<{messageId: string}>};
}
export {};

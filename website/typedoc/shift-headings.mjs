import {Converter, ReflectionKind} from "typedoc";

const MAX_LEVEL = 6;
const TOP_LEVEL_SHIFT = 1;
const MEMBER_SHIFT = 3;
const ACCESSOR_SHIFT = 4;

const shiftHeadings = (text, by, startsLine) => text.replace(/^(#{1,5}) /gm, (heading, hashes, offset) => {
  if (offset === 0 && !startsLine) return heading;
  return `${"#".repeat(Math.min(hashes.length + by, MAX_LEVEL))} `;
});

const shiftParts = (parts, by) => {
  parts.forEach((part, index) => {
    if (part.kind !== "text") return;
    const previous = parts[index - 1];
    const startsLine = !previous || (previous.kind === "text" && previous.text.endsWith("\n"));
    part.text = shiftHeadings(part.text, by, startsLine);
  });
};

const shiftOf = (reflection) => {
  const isAccessorSignature = reflection.kindOf(ReflectionKind.GetSignature | ReflectionKind.SetSignature);
  if (isAccessorSignature) return ACCESSOR_SHIFT;
  const owner = reflection.kindOf(ReflectionKind.SomeSignature) ? reflection.parent : reflection;
  const isTopLevel = owner?.parent?.kindOf(ReflectionKind.SomeModule | ReflectionKind.Project);
  return isTopLevel ? TOP_LEVEL_SHIFT : MEMBER_SHIFT;
};

export const load = (app) => {
  app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    const shifted = new WeakSet();
    for (const reflection of context.project.getReflectionsByKind(ReflectionKind.All)) {
      const comment = reflection.comment;
      if (!comment || shifted.has(comment)) continue;
      shifted.add(comment);
      const by = shiftOf(reflection);
      shiftParts(comment.summary, by);
      comment.blockTags.forEach((tag) => shiftParts(tag.content, by));
    }
  });
};

import {dynaError} from "dyna-error";

import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {makeGatewayConfig} from "../internal/utils/makeGatewayConfig";
import {unimplementedClasses} from "../internal/utils/unimplementedMembers";

/**
 * Calls a method or reads a getter straight from the prototype.
 * An unimplemented member throws before it touches `this` or its arguments, so no instance is needed.
 * A member that does not exist fails the test: a method of the Contracts cannot be dropped silently.
 * A member that was implemented but left in the list does not throw here; when it is async, its rejection
 * (it runs without `this`) is swallowed, so the test fails on its expectation instead of crashing the run.
 */
const callMember = (prototype: object, member: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, member);
  if (!descriptor) {
    throw dynaError({
      code: 5372567786082,
      message: `Member not found on the class: ${member}`,
      data: {member},
    });
  }
  const returned: unknown = descriptor.get
    ? descriptor.get.call(undefined)
    : descriptor.value.call(undefined);
  if (returned instanceof Promise) returned.catch(() => undefined);
  return returned;
};

describe("skeleton", () => {
  test("AIGateway is constructed with in-memory adapters and a FakeLLMClient", () => {
    expect(() => new AIGateway(makeGatewayConfig(), {llmClient: () => new FakeLLMClient()})).not.toThrow();
  });

  unimplementedClasses.forEach(({
    classRef,
    members,
  }) => {
    describe(`${classRef.name}`, () => {
      Object.entries(members).forEach(([milestone, names]) => {
        test.each(names)(`${milestone}: %s throws "Not yet implemented"`, name => {
          expect(() => callMember(classRef.prototype, name)).toThrow("Not yet implemented");
        });
      });
    });
  });
});

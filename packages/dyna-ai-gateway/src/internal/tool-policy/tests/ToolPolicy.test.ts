import {ToolPolicy} from "../ToolPolicy";
import {
  IResolvedTools,
  IToolPolicyConfig,
} from "../types";
import {
  allTools,
  makeCaps,
  makeProfile,
  makeUserContext,
} from "./utils/toolPolicyFixtures";

const resolve = (
  {
    config = {},
    allowedTools = ["get_invoice", "refund", "send_email"],
    approvals = [],
    permissions = [],
    capsTools = true,
    activeTools,
    builtInTools,
  }: {
    config?: IToolPolicyConfig;
    allowedTools?: string[];
    approvals?: string[];
    permissions?: string[];
    capsTools?: boolean;
    activeTools?: string[];
    builtInTools?: string[];
  } = {},
): IResolvedTools =>
  new ToolPolicy(config).resolve({
    allTools,
    profile: makeProfile(allowedTools, approvals),
    userContext: makeUserContext(permissions),
    caps: makeCaps(capsTools),
    activeTools,
    builtInTools,
  });

const names = (resolved: IResolvedTools): string[] => resolved.tools.map(tool => tool.name);

describe("ToolPolicy", () => {
  describe("M2 — resolve: which tools the model sees", () => {
    test("returns the registered tools that the profile allows", () => {
      expect(names(resolve({allowedTools: ["get_invoice", "refund"]}))).toEqual(["get_invoice", "refund"]);
    });

    test("a tool that the profile does not allow is hidden", () => {
      expect(names(resolve({allowedTools: ["get_invoice"]}))).not.toContain("refund");
    });

    test("caps.tools = false yields an empty tool set and no approvals", () => {
      const resolved = resolve({capsTools: false});
      expect([names(resolved), [...resolved.approvals]]).toEqual([[], []]);
    });

    test("a tool mapped to a permission is hidden from a user without it", () => {
      const resolved = resolve({config: {permissionsToTools: {"billing.refund": ["refund"]}}});
      expect(names(resolved)).toEqual(["get_invoice", "send_email"]);
    });

    test("a tool mapped to a permission is visible to a user who has it", () => {
      const resolved = resolve({
        config: {permissionsToTools: {"billing.refund": ["refund"]}},
        permissions: ["billing.refund"],
      });
      expect(names(resolved)).toContain("refund");
    });

    test("one of several permissions that unlock a tool is enough", () => {
      const resolved = resolve({
        config: {
          permissionsToTools: {
            "billing.refund": ["refund"],
            "admin": ["refund"],
          },
        },
        permissions: ["admin"],
      });
      expect(names(resolved)).toContain("refund");
    });
  });

  describe("M2 — resolve: which tools need approval", () => {
    test("approvals come from the profile", () => {
      const resolved = resolve({approvals: ["get_invoice"]});
      expect(resolved.approvals.has("get_invoice")).toBe(true);
    });

    test("approvals come from the tools' policy: NEEDS_APPROVAL", () => {
      expect([...resolve().approvals]).toEqual(["refund", "send_email"]);
    });

    test("the profile's approvals add to the tools' own", () => {
      const resolved = resolve({approvals: ["get_invoice"]});
      expect([...resolved.approvals]).toEqual(["get_invoice", "refund", "send_email"]);
    });

    test("a tool outside the resolved set is never in the approvals", () => {
      const resolved = resolve({
        allowedTools: ["get_invoice"],
        approvals: ["refund"],
      });
      expect([...resolved.approvals]).toEqual([]);
    });
  });

  describe("M6 — resolve: activeTools, the call's own selection (D48)", () => {
    test("activeTools narrows the set to the tools it names, in the order of the registry", () => {
      expect(names(resolve({activeTools: ["send_email", "get_invoice"]}))).toEqual(["get_invoice", "send_email"]);
    });

    test("an empty activeTools offers no tool", () => {
      expect(names(resolve({activeTools: []}))).toEqual([]);
    });

    test("the approvals follow the narrowed set", () => {
      const resolved = resolve({activeTools: ["get_invoice", "refund"]});
      expect([...resolved.approvals]).toEqual(["refund"]);
    });

    test("a tool the profile does not allow throws a 400 with code 5373897180054 naming it", () => {
      expect(() => resolve({
        allowedTools: ["get_invoice"],
        activeTools: ["get_invoice", "refund"],
      })).toThrow(expect.objectContaining({
        code: 5373897180054,
        status: 400,
        data: {
          profileId: "careful",
          notAllowedTools: ["refund"],
        },
      }));
    });

    test("a tool the user's permissions do not unlock throws the same 400", () => {
      expect(() => resolve({
        config: {permissionsToTools: {"billing.refund": ["refund"]}},
        activeTools: ["refund"],
      })).toThrow(expect.objectContaining({code: 5373897180054}));
    });

    test("the names are checked also when the model cannot call tools", () => {
      expect(() => resolve({
        capsTools: false,
        activeTools: ["unknown_tool"],
      })).toThrow(expect.objectContaining({code: 5373897180054}));
    });
  });

  describe("M6 — resolve: the gateway's built-in tools (D61)", () => {
    test("a built-in tool is offered although the profile does not allow it, in the order of the registry", () => {
      expect(names(resolve({
        allowedTools: ["refund"],
        builtInTools: ["send_email"],
      }))).toEqual(["refund", "send_email"]);
    });

    test("a built-in tool is offered to a user whose permissions do not unlock it", () => {
      const resolved = resolve({
        config: {permissionsToTools: {"mail.send": ["send_email"]}},
        builtInTools: ["send_email"],
      });
      expect(names(resolved)).toContain("send_email");
    });

    test("activeTools does not drop a built-in tool and does not need to name it", () => {
      expect(names(resolve({
        activeTools: ["get_invoice"],
        builtInTools: ["send_email"],
      }))).toEqual(["get_invoice", "send_email"]);
    });

    test("the profile's approvals do not apply to a built-in tool", () => {
      const resolved = resolve({
        approvals: ["get_invoice"],
        builtInTools: ["get_invoice"],
      });
      expect([...resolved.approvals]).toEqual(["refund", "send_email"]);
    });

    test("a built-in tool's own policy: NEEDS_APPROVAL counts (D87)", () => {
      const resolved = resolve({builtInTools: ["send_email"]});
      expect(resolved.approvals.has("send_email")).toBe(true);
    });

    test("no tool is offered when the model cannot call tools", () => {
      expect(names(resolve({
        capsTools: false,
        builtInTools: ["send_email"],
      }))).toEqual([]);
    });
  });

  describe("M3 — narrowForStep (guarded workflows)", () => {
    const guarded: IToolPolicyConfig = {requires: {refund: ["get_invoice"]}};

    const narrow = (config: IToolPolicyConfig, executed: string[]): IResolvedTools =>
      new ToolPolicy(config).narrowForStep({
        resolved: resolve({config}),
        executed,
        stepIndex: executed.length,
      });

    test("returns the resolved set unchanged when no tool has requirements", () => {
      const resolved = resolve();
      expect(new ToolPolicy({}).narrowForStep({
        resolved,
        executed: [],
        stepIndex: 0,
      })).toBe(resolved);
    });

    test("hides a tool until the tools it requires have been executed", () => {
      expect(names(narrow(guarded, []))).toEqual(["get_invoice", "send_email"]);
    });

    test("shows the tool once its requirement has been executed", () => {
      expect(names(narrow(guarded, ["get_invoice"]))).toEqual(["get_invoice", "refund", "send_email"]);
    });

    test("a tool with several requirements needs all of them", () => {
      const config: IToolPolicyConfig = {requires: {refund: ["get_invoice", "send_email"]}};
      expect([names(narrow(config, ["get_invoice"])).includes("refund"), names(narrow(config, ["get_invoice", "send_email"])).includes("refund")]).toEqual([false, true]);
    });

    test("a hidden tool is not in the approvals of the step", () => {
      expect([...narrow(guarded, []).approvals]).toEqual(["send_email"]);
    });

    test("does not change the resolved set it was given", () => {
      const resolved = resolve({config: guarded});
      new ToolPolicy(guarded).narrowForStep({
        resolved,
        executed: [],
        stepIndex: 0,
      });
      expect(names(resolved)).toEqual(["get_invoice", "refund", "send_email"]);
    });
  });
});

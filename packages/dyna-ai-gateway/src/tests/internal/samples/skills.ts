import {ISkill} from "../../..";

/** A profile skill: the rules a refund question needs; its body carries a token no model knows, so a test can see it was loaded. */
export const refundPolicySkill: ISkill = {
  name: "refund_policy",
  description: "The refund rules of the shop: deadlines, exceptions, who approves",
  body: "# Refund policy\n\nA refund is granted within 14 days of delivery. Above 500 EUR the token REFUND-7731 must be quoted to the customer.",
};

/** A second profile skill, so a test can tell the list from one entry. */
export const escalationSkill: ISkill = {
  name: "escalation",
  description: "When and how to hand a case to a human agent",
  body: "# Escalation\n\nHand over when the customer asks for a manager or threatens legal action. Quote the token ESC-4410.",
};

/** A skill a call brings on top of the profile's. */
export const exportWizardSkill: ISkill = {
  name: "export_wizard",
  description: "The steps of the CSV export the user may be in",
  body: "# Export wizard\n\nStep 1 picks the columns, step 2 the delimiter. Quote the token EXP-9001.",
};

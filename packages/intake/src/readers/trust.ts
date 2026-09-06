import { format, fromMinor } from "@magna-carta/money/format";
import { currencyFromCode } from "@magna-carta/money/money";
import { readMatterTrustPositions } from "@magna-carta/trust/close-precondition";
import type { IntakeStepReader } from "../checklist.ts";

// The retainer step, answered by the matter's client trust ledgers. Satisfied when the matter holds
// client money in trust — the retainer arrived and was receipted — and outstanding otherwise. A
// retainer paid into the operating account under a flat-fee arrangement is a real thing this cannot
// see, which is why the kind is also recordable by a member.
export const retainerStepReader: IntakeStepReader = async ({ database, matterId }) => {
  const positions = await readMatterTrustPositions(database, matterId);
  const held = positions.filter((position) => position.balanceMinor > 0);
  if (held.length === 0) {
    return { satisfied: false, statement: "The matter holds no client funds in trust." };
  }
  const amounts = held
    .map(
      (position) =>
        `${format(fromMinor(position.balanceMinor, currencyFromCode(position.currency)))} on ${position.trustAccountName}`,
    )
    .join(", ");
  return { satisfied: true, statement: `Held in trust for this matter: ${amounts}.` };
};

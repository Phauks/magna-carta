# Roles and sub-roles

A role is a set of things a member may do. A member can hold any number of roles and may do anything
any of them allows. **Settings › Firm › Roles and Permissions** lists what each role allows, and
**Settings › Firm › Users** is where you give roles to people.

## The roles a firm starts with

- **Admin**: administers the firm, its members and its settings. Anybody can hold Admin, whatever
  else they hold. A partner, an associate or an office manager can all be Admin.
- **Attorney**, with two sub-roles:
  - **Partner**
  - **Associate**
- **Paralegal**
- **Billing**
- **Read-only**

## Sub-roles

A sub-role is a kind of the role it sits under. A Partner is an Attorney, and so is an Associate.

- **A sub-role includes everything its parent allows.** Whoever holds Partner can do everything an
  Attorney can, and counts as an attorney everywhere the firm's attorneys are listed.
- **A sub-role only adds.** It never takes anything away from the parent. On Roles and Permissions, a
  sub-role lists only what it adds. If you want associates to be able to do less than attorneys can
  today, that is something to take out of Attorney and give to Partner.
- **Partner adds** the firm's financial and productivity reports, seeing every timekeeper's time,
  approving time and costs, and reopening a closed matter.
- **Associate adds nothing yet.** It still keeps associates together, and a rate card can give them
  their own default rate.

## Giving someone a sub-role

On **Users**, open a member's roles. The sub-roles are listed under the role they belong to:

- Ticking **Partner** ticks **Attorney** too.
- A member holds one sub-role of a role, so ticking **Partner** unticks **Associate**.
- Unticking **Attorney** unticks its sub-roles.

When you invite somebody as a Partner or an Associate, they arrive holding Attorney as well.

## Billing rates

A rate card can set a rate for a role. A Partner's time uses the Partner rate if the card has one,
then the Attorney rate, then the card's default. A rate set for one particular attorney always wins
over any role rate.

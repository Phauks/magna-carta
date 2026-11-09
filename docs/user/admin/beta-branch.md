# The beta branch

Magna Carta ships new work in two builds: the released one, and the one ahead of it. Under
**Settings › Data & Platform › Beta Access** an administrator decides which of the two the firm runs.

## Joining and leaving

The **Beta Branch** plate holds one switch, **Beta Programme**. It shows where the firm is: off on
the released build, on while the firm is on the beta build.

Turning it on asks first. The beta build runs against the firm's real matters, real client money
and real documents, not a copy, so joining takes an explicit acknowledgement, and the page says what
you are accepting before you press **Join the Beta Programme**. If you cancel instead, nothing
changes and the switch stays off: it shows the firm's actual channel, never the press.

Turning it off asks nothing. The firm steps back to the released build at once, and what a beta
build already recorded stays recorded.

Joining is recorded in the firm's audit log against the member who joined.

## A firm on the alpha channel

A firm can be placed on the alpha channel by the platform. That channel cannot be entered or left
from this page, so the page states it and offers no switch.

## Who can change it

Moving the firm between the released build and the beta needs the `firm:manageReleaseChannel`
permission, which is granted to the Admin role. Everybody else sees where the firm is.

## Related features

- [`../features/seeing-what-version-you-are-on.md`](../features/seeing-what-version-you-are-on.md):
  which build every part of the platform is on.

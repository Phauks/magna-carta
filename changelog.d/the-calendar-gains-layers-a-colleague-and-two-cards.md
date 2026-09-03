---
category: Added
audience: public
---

**The calendar's second round: layers, a colleague, a settled filter, and two cards.** The firm calendar can be widened to the timeline's date-bearing sources through a LAYER (`CALENDAR_LAYERS` in `apps/web/src/lib/calendar/calendar-vocabulary.ts`): custody dates first, the due-backs and review dates the safe custody register already federates, each painting its custody number and opening the register. Only sources whose rows fall due qualify; the timeline's history sources stay in the timeline rather than flooding a month. A colleague picker seats after Mine and Everyone and reads one colleague's calendar through the same member filter, under the reader's own visibility. The agenda gains "Hide settled", which leaves out cancelled settings and satisfied, vacated or superseded deadlines and says how many it left out; the month and the week always paint them struck (owner flag C5). Every refinement is mirrored into the address.

The firm-wide read now says a setting was called off: the `matterEvent` source emits `cancelledEvent` as its own kind (a closed word, never the reason a person typed), so the firm grid strikes a vacated hearing exactly as the matter section does, and the settled filter can leave it out. Before this the federated row carried no status and a cancelled hearing painted on the firm calendar as if it were still on.

`CalendarView` takes `agendaDays` and `limit`, and two hosts embed it: Home's Today card (the reader's own scope, today and tomorrow, six rows, a line to the rest) and the matter overview's Coming up card (the matter's next thirty days, six rows, a line to the Calendar section). Neither writes a read of its own.

## Public

**The calendar reaches Home and the matter overview, and it can show more.** Home now opens with **Today**: what is on your own calendar today and tomorrow. A matter's Overview shows **Coming up**, its next thirty days. Both open the same window an entry opens everywhere. On the firm calendar, pick a colleague to read their calendar beside your own and everyone's; press **Custody dates** to add the register's due-back and review dates; and on the agenda, press **Hide settled** to see only what is still coming.

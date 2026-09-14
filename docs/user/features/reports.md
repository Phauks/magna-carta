# Reports

Reports is where the firm's records are read back as a document: a question asked over a period,
answered from what the firm has already recorded, shown on screen and taken away as a file. Open it
from the sidebar under Firm.

## The two sides of the screen

Reports has a column on the left and the report on the right. The column lists every report the
platform offers, grouped by family, and stays there whichever report you have open: the one you
are on is marked, and clicking another in the column opens it in place. A report marked **Soon**
is in the column too, greyed and not clickable; resting the pointer on it says what it is waiting
on. On a narrow window the column sits above the report instead of beside it.

The way back at the top of a report still returns you to the index, and the column is there as
well; use whichever is closer to hand.

## The catalogue

On arriving, the right side is the index: every report the platform offers, grouped by family
(trust compliance, financial, productivity, and operational), each entry saying what the report
answers. A report you can run opens when you click it, from the index or from the column. A report
marked **Soon** is listed so you can see what is coming; it says what it is waiting on and does
nothing yet.

The trust compliance report runs today. The accounts receivable aging, work in progress, realization,
timekeeper productivity, and operational volumes reports are listed and marked Soon.

**To find a report, use the magnifying glass at the top right.** Type and the page narrows as you
type, showing only the reports that match and only the families that still have one; the count
inside the field says how much of the whole you are looking at. It searches a report's name, the
question it answers, the family heading, and the permission it runs under. Clear it with the cross
at the end of the field, or press Escape.

The two buttons beside the search choose how the index reads: **tiles**, a card per report with its
question at full length, or **list**, one dense line each. The choice is remembered in this browser.
It is the same screen the [Tools](tools.md) catalogue uses, and each remembers its own choice. The
column on the left is not affected by the view or the search: it always shows every report.

## Running a report

Open a report and set its controls at the top of the page. The report runs as soon as they are
complete; there is no Run button, and changing any control runs it again.

- **Trust Account.** Which account the report is about. Closed accounts are listed beside open ones,
  because a compliance report is often asked about a period after the account closed.
- **Period.** A named span (this or last month, quarter, or year) or any range you pick. The range
  applies as you pick it.
- **As Known.** Whether the report includes everything known now, or the figures as they stood at
  the end of a chosen day. Choosing a day makes the report reproducible: the same period and the
  same day give the same figures whenever you run it again. Everything known now is a live report,
  and the report says so on its face. The day ends at midnight in the time zone of the office that
  holds the account, and the control names that zone; an office with no zone recorded reads in
  universal time.

What the trust compliance report lists, such as whether ledgers at zero all period appear and
whether the person who authorized each payment is named, is decided once for the whole firm under
Settings; see [The trust compliance report policy](../admin/trust-compliance-report-policy.md).

Every control is part of the page's address, so copying the address and sending it shows a
colleague the same report with the same settings.

## Reading the answer

The report appears below the controls as a series of tables, each with a heading. A line at the top
states whether the report is reproducible or live, in the same words the exported file carries. A
section with nothing in it says so in its one row rather than disappearing, so you can tell "no
holds were in force" from a section that was not produced.

Names, matter numbers and office details are as they stood when the report was produced; every line
also carries the record's own identifier, which does not change.

## Exporting

The Export menu at the top of the page offers every format the platform exports: Excel (a sheet per
table, or one sheet), Word, PDF, CSV and plain text. The file carries exactly the tables on screen.
Exports are kept on your Downloads shelf for a short while, so several can be gathered and taken
together; see [Downloads](../downloads.md).

## Who can run reports

Each report family has its own permission, separate from the permissions that let somebody read a
single record. Owners and administrators hold them all. A report you may not run says so where its
answer would be. Picking a trust account for the trust compliance report also needs the permission
to read trust, and the page says so in those words if your account lacks it; a firm that grants
somebody the report alone should grant that beside it.

## Related

- [The trust compliance report](trust-compliance-report.md): what each section of that report means
  and when it will not be produced.
- [Downloads](../downloads.md): where an exported file goes.
- [Tools](tools.md): the firm's workbench, on the same two-sided screen.

# Record Transfer

Record Transfer brings your firm's people, organizations and matters in from the system you are
leaving. You work one file at a time: upload it, say what each of its columns has in it, run it, and
read what arrived and what did not. LEAP is the first system supported.

**Record Transfer** is under **Firm** in the sidebar. Owners and Admins see it.

## Runs

A run is one attempt at bringing the records across. A firm usually makes several: rehearsals first,
then the real one.

1. Open **Record Transfer** and choose **New Run**.
2. Name the run, for example "Rehearsal 1", and choose **Start Run**.

The list shows every run, newest first, with who started it and whether it is open, accepted or
abandoned. Open a run to work on its files.

## Uploading a file

1. In the run, choose **Upload a File**.
2. Pick the file and say what it has in it: **People**, **Organizations** or **Matters and
   Parties**.
3. Choose **Upload**.

The file is a table saved as text, one row per record, with the column names on the first row.
Upload people and organizations before matters. A matter names its client and its other parties by
their key in the people or organizations file, so those records need to be there first.

## Saying what each column has in it

Select a file on the left and open the **Columns** tab. Each column of the file is listed with its
first few values. Under **Holds**, pick what the column has in it. A column starts as **Do Not Bring
In**.

- **Key of Each Row** is the column that tells one row from another, such as a card number. Every
  file needs one. In a matters file the matter number is the key unless you pick another column.
- A date column asks for the order its dates are written in, such as day, month, year.
- In a matters file, a **Client** or **Party** column asks which file its keys come from, and a
  party column asks for the party's role.
- A **Matter Type** column asks you to match the codes in the file to your firm's matter types.
  Choose **Match Types**, add each code and pick its type.
- A **Responsible Member** column asks you to match staff codes to members the same way, under
  **Match Staff**. **Everyone Else** is the member who takes a matter whose code is not matched.

The **Still Needed** line lists what the file cannot be run without. If you choose **Run** while
something is still needed, the fields to fix are outlined in red.

## Running a file

Choose **Run**, or **Run Again** for a file that has been run before. The file's status goes from
Waiting to In Progress to Done. You can leave the page while it works.

Running a file again brings nothing in twice. A row that arrived on an earlier pass is counted as
arrived and left alone, so you can correct the columns or the file and run it as often as you need.

The badges on a file show its latest pass: rows that arrived in green, rows waiting on another
record in amber, and rejected rows in red.

## Reading the report

The **Report** tab lists what the latest pass could not bring in as written, each with its line
number in the file and the reason:

- **Rejected Rows** did not arrive. For example, the row has no name, or an earlier row has the same
  key.
- **Waiting Rows** name a record that has not arrived yet, such as a client whose card was rejected.
  Fix that record, then run this file again.
- **Left-Out Values** are single values that could not be read, such as an email that is not an
  address. The record arrived without that value.

If the pass failed, the report says why. For example, a quoted value in the file is never closed,
with the line it starts on.

## Checking a sample

The **Sample** tab lists rows that arrived, each with a link to the person, organization or matter
it became. Open a few and compare them with the file.

## Before Cutover

The left panel keeps count of what stands between this run and switching over:

- **Every card arrived or was decided** and **Every matter arrived** count the rows still rejected
  or waiting in the latest pass of each file.
- **Trust balances match** and **10 samples checked by eye** are not counted yet. They show as Not
  run and Not done.

# Product changelog

What changed in Magna Carta, written for the people who use it. Entries are dated rather than
versioned: the product ships continuously and no release has been cut, so a date is the honest unit.

This file is **assembled, never hand-edited on a branch.** Its entries come from the `## Public`
blocks of `audience: public` fragments in [`changelog.d/`](../changelog.d/), folded in on `main` by
`vp run changelog-build` — the same one pass that folds the developer half of those fragments into
[`CHANGELOG.md`](../CHANGELOG.md). Two audiences, two sets of sentences, one source and one review.

Curation happens here, in this file, at publish time: the folded entries are the raw material, and
a dated section may be edited on `main` into the thematic roll-up a reader actually wants rather
than one bullet per merge. What is never done here is authoring a change that has no fragment
behind it.

Categories: **Added · Changed · Deprecated · Removed · Fixed · Security.**

## 2026-11-14

### Added

- The New Check panel's Advanced Settings has a **Trigram matching** box, on by default. Clearing it stops the check from finding names that only share a few letters with a party's, which is the noisiest kind of result. Widest always keeps it on. A check run without it says so in its Details and its report.
- **Read a saved email and keep it as a PDF.** Drop an `.eml` or `.msg` file on the File Workbench and open the **Email** tab to see who sent it and to whom, when, whether the sending domain signed it, the mail servers it passed through in order, its text and its attachments. An attachment opens on the workbench as a file of its own, or saves to your computer. **Save as PDF** writes the message as a PDF with an attachment list, and **Include every header** adds a page with every header line. All of it happens in your browser; nothing is uploaded.
- **See what a document or photo is hiding, and send a clean copy.** Open a Word document, JPEG or PNG on the File Workbench's **Metadata** tab to see its tracked changes, comments, hidden text, author and editing details, attached data and a photo's camera and location details, each in its own table. Untick anything you want to keep, then save a clean copy or put it on the workbench to check first. The copy is read again as soon as it is made, and the original is never changed. Everything happens in your browser.
- Magnus can now write drafts as documents you keep in the conversation, with every version, and can
  read your own earlier conversations on the same matter when you turn that on.
- **When a meeting's video stutters or freezes, open Connection Details and press Copy Diagnostics.** It copies what each picture did over the last few minutes, so you can paste it into a message to whoever is helping. It contains numbers only, no names and nothing anyone said.
- When you open a poll in a meeting you now choose its Poll Type. One and Multiple work as before. Ranking asks everyone to put the answers in order and shows the room's order. Score asks for a number on a scale and shows the average.
- **Long dropdowns can be searched.** When a dropdown has more than seven choices, open it and start typing: the list keeps only the choices that contain what you typed, anywhere in the name, and Enter picks the top one. Backspace widens the list again, and Escape clears your search.
- **Text Size now works, and Font Family shows each typeface in itself.** In Settings, then Text, you can set interface text anywhere from 50% to 200% of its normal size; it changes at once and stays your choice on this browser. The Font Family list now shows each typeface in that typeface, so you can see it before you pick it.
- **The Search page finds invoices, parties and custody packets on every matter you can see.** Type a
  name to see each matter that person or organization is a party on, a few words from an invoice line
  or an invoice number to find the invoice, or a packet name or custody number to find the packet.
  Each result names its matter and opens in that matter's own section, and you see only the places
  your role includes.
- Matters have a new Exhibits section. Choose Make Exhibits on a folder in Files and its documents become Exhibit A, B, C, in order. Drag exhibits to reorder them, and the labels follow. Before anything is saved you see which labels change. Mark a set as filed when it goes out and its labels are kept exactly as filed.
- **Take everything that can act out of a file before you open it.** On the File Workbench's **Malware Scan** tab, a PDF, Office document, RTF document or picture now shows everything in it that runs, opens or fetches on its own: scripts and macros, actions that run on opening, embedded objects and files, controls, and links fetched without asking. **Save a Disarmed Copy** gives you the file with all of that removed and the text, formatting, pictures and web links kept. A Word file with macros comes back as a plain Word file. The original is never changed, and it all happens in your browser.
- **Convert a document from its right-click menu.** Right-click a file in a matter and open **Convert** to turn it into a PDF, a text file or another format it can become. The converted copy is filed beside the original, and the original is never changed.
- **Download a selection, or the whole matter, as one bundle.** Right-click files and folders on a matter and choose **Download as Bundle**, or right-click the empty space for **Download Matter as Bundle**. Pick Zip or 7z and how hard to compress it. You can also add a password, which encrypts it with AES-256, split a 7z bundle into parts that fit an email or a disc, flatten the folders, and include a contents list with each file's fingerprint. Large bundles build in the background and download when they are ready.
- You can change the name you go by in a meeting from your own row under People. Everybody still sees the name you joined with beside it, and one press puts your account name back.
- Five new reports: Accounts Receivable Aging, Work in Progress, Realization, Timekeeper Productivity and Operational Volumes. Each opens with a row of totals, then a table by office with the firm total, then a table by client you can sort by any column; press a client to see its matters. Every report can be narrowed to one office. Aging, Realization and Operational Volumes can be fixed "as known" at the end of a chosen day, so the copy reads the same every time it is run. Timekeeper Productivity reports the time recorded and sets no target. Export carries the same tables.
- Two new reports under Financial. **Invoices** lists the bills issued in a period with what was billed, credited, applied and still unpaid at the end of it, by office and client. **Payments Applied** lists every payment, transfer from trust, credit and write-off set against a bill, with any reversal on its own line.
- A new Matter Balances report shows, for each matter, the unbilled time and costs, what its bills still owe, and what is held for it in trust, side by side, by office and by client.
- **Billing choices are all on screen.** When you log time or record a cost or a fee, the billing choices sit side by side and you pick one with a single click, instead of opening a list.
- The Meetings page now has Shared Rooms: rooms the firm keeps for a place, such as a conference room. Anyone who can host meetings can set one up, open it, rename it or remove it. You can also rename your own room from the "..." menu on My Room. A room's link follows its name.
- **Add a task straight from the Tasks list, and set a repeat in its own window.** Every group in the
  Tasks list now ends in an Add a task line: type what to do and press Enter, and the task lands in
  that group, on its list, status, person, matter or day, with the line left open for the next one.
  Making a task repeat now opens a window of its own, and once a task repeats it shows the rule as a
  sentence with a Change Repeat button, so the series cannot be changed by a stray click.
- **Convert files on the File Workbench.** Select one file or many, open **Convert** and press a format. Each file is converted in turn, and every copy can be saved or put on the bench beside the original. The originals are never changed.
- **Repair a damaged file, and get the text out of a scan, on the File Workbench.** The **Repair** tab diagnoses a damaged file, then rebuilds a copy or pulls whole pictures and documents out of it, and lists exactly what came back and what did not. The **Text Recognition** tab reads the text of a scan page by page, flags pages worth checking, and saves a searchable PDF or the text on its own. Both run only when you ask, and the original is never changed.

### Changed

- On a conflicts check, the Directory row of the Status section now opens onto blocks, one per row. They say when and by whom the search ran, how names and identifiers were compared, how far relationships were followed, how Firm Employees were checked, what was not searched and why, and what turned up. Anything not searched, or a part of the search that stopped short, is tinted so it stands out. The printed report has the same parts.
- **When a page crashes, the error screen now shows a short Cause line beside the Error ID**, so a report says which part of the app failed, not just when.
- **Dropdowns are easier to scan.** Options now line up with the text in the field above them, the one you have chosen is marked with a tick at the end of its row, and group headings stand out from the options under them. Every dropdown shows the same arrow, whether or not you can type in it.
- **Forms are easier to read and fill in.** Every text box, dropdown and date field now has a clear outline, darkens slightly when you point at it, and shows a gold ring where you are typing. A field you cannot change has a dashed outline instead of looking like a button, and secondary buttons such as Cancel are outlined so the main action in a window stands out.
- **Videos and sound recordings play in the browser.** Recordings now stream on the site instead of
  offering only the download.
- **The "..." menus open only when you click them.** Moving the pointer over a "..." button no longer drops its menu over the page; click it, or press Enter on it, to open it. Menus with a name, such as Money on a matter, still open when you point at them.
- Meeting links are shorter and easier to read out. A meeting's address now ends in nine digits, like /meeting/482-917-305, and your own room's address is your name, like /room/trevor.
- **Connection Details in a meeting is easier to read.** It now opens as a wider panel in two columns (your own connection on the left, everyone else and recent events on the right) instead of a narrow strip running off the screen.
- Connection Details in a meeting are easier to read. They show which Cloudflare site your meeting runs through, your picture size in pixels, your upload and download, and what Good, Fair and Poor mean. Your camera now uses less upload: about 1.7 Mbit/s at most, down from about 2.5 Mbit/s.
- **Leave now always sits in the bottom-right corner of a meeting**, and the panel on the right stands out more clearly from the meeting picture.
- Questions in a meeting now live in the chat. Tick Ask as a question to ask one, and use Questions at the top of the chat to see only the questions. We also fixed a brief flash in the meeting picture, and Copy Diagnostics now notes what the screen did with the pictures, so a flash that still happens can be traced.
- **Chat, Q&A, polls and the list of people are now one panel on the right of the meeting, with a tab for each.** It opens on Chat, a second press on the same control closes it, and someone's raised hand shows beside their name under People. The controls along the bottom are grouped: your microphone, camera and effects on the left; presenting, raising a hand, reactions and recording in the middle (with the host's options behind a "..." menu); and the panel's tabs and Leave on the right.
- **Meetings open in speaker view, with the gallery one press away.** Your choice is remembered in this browser. Pictures keep the camera's wide shape, so two people on a laptop sit side by side, and whoever is talking gets a clear ring and a speaking mark beside their name. A Share button in the meeting copies its link for people at the firm and lets a host invite guests. Effects has a new Mirror My Video switch, on by default: it flips only your own preview, and everybody else still sees you the right way round.
- The Meetings page now lists everybody's room, so you can copy a colleague's link ahead of time or join when they are in. Your own room's settings are tucked into a "..." menu, and the History list shows which matter each meeting was filed on and whether it was recorded.
- **Each part of a person's record is a card you can fold away.** On New Person and in a record's window, every section sits in its own card with its name and how many entries it holds at the top; press the header to fold it, and choose it in the list on the left to open it again. Beside New Person, the Directory check says plainly whether anyone similar is already recorded, and below it the person is shown the way their record will open, photo and name first.
- **Clearer "Soon" hints.** Features that aren't built yet now say plainly what's missing, such as "Not built yet: recording payments."
- **Clearer matter, file and tool screens.** Help text across matters, files, documents, calendar, discovery, custody, reports and the tools is shorter and plainer.
- **Clearer settings and billing screens.** Help text on the settings pages and on bills, trust, time, costs and fees is shorter and plainer, and the app now says "bill" consistently instead of switching between "bill" and "invoice".
- **Looking at a client's photo no longer starts editing it, and contact details are easier to change.** Press a photo in a Directory record to see it large on the same screen; press Edit Photo to change or remove it, all in one window. Photos can now be JPEG, PNG, WebP, GIF, AVIF, BMP or SVG, and the window lists what it takes. The Preferred star on an email, number or address can now be turned off again, and jumping to the last section of a record no longer leaves you unable to scroll back up. To change a record's email addresses and numbers, press Edit on its Contact section to change every line at once and save it in one go. The Relationship list is now in alphabetical order under headings, with family ties such as Parent, Child and Spouse in a Family group of their own.
- **Shorter, plainer messages.** When a save or a load can't reach Magna Carta, the message now says "Couldn't connect." and what didn't happen. Long help lines on matter sections, settings, billing, trust, the calendar, files, discovery and sign-in were cut down to what you need to act.
- **Settings › Versions is now System Status, and it starts with what works.** The page opens on a
  count of features, deployment, workers and recent errors. Below that, tabs list every feature as
  Working, Not set up or Not working, along with the build you are on, the platform's services, your
  firm's records and your feature flags. The version chip at the top of the screen is shorter: it
  shows the build, any feature that is not working, and a button to the full page.
- **System Status is one press away.** A pulse icon beside Customize at the bottom of the sidebar
  opens the System Status page.
- When you type an address, each suggestion now shows the street with the part you typed in bold and the town and state underneath, so the right one is easier to spot. Saved addresses have a map button that opens them in Google Maps, and a nine-digit ZIP+4 gets its hyphen as you type and is kept in full.
- **A record being created shows the number it will be saved under, and cancelling gives it back.** The New Matter, New Check and New Packet windows and the call and text log now show the record's number in italics before it is saved, in place of the sentence "A number is drawn when this is saved." Two people creating the same kind of record at once are shown different numbers, and the record is saved under exactly the number shown. Closing the window without saving gives the number back for the next record, so the numbering keeps no gap; a window left open and abandoned gives its number back after fifteen minutes. Invoice numbers are still given only when a bill is finalized, so they stay gapless and in issue order.
- Exported PDFs, reports among them, now have the same look as the other documents Magna Carta produces: the Magna Carta heading on every page, each table in its own titled box, and long tables split across pages with "(1 of 3)" in the title.
- **Errors now say what went wrong.** When something fails, the message names the part of Magna Carta, the action and the kind of failure, so the screen alone usually tells you what happened. **Show details** opens the rest, and **Copy details** puts the whole report on your clipboard. Every Error ID is now kept for 30 days, so it can be looked up later.
- **A new default typeface, with a plain zero.** The app's text is now set in Inter. Dates and amounts read as numbers again, without the slashed zero. If you preferred the old face, choose Atkinson Hyperlegible under Settings, Text, Font Family.
- **Enter sends a question to Magnus.** Shift+Enter starts a new line, and a word still being typed through an input method is never sent early. Each message in a Magnus conversation now shows its date as well as its time.
- **One switch style on the Magnus page.** The conversation order in the list and the Context, Permissions and Artifacts switch beside the conversation now use the same switch as the rest of the app, with the chosen option raised and outlined.
- **The Magnus page uses its space better.** The conversation list is wider and the conversation itself spreads across more of the page. Changing the list's order or searching it no longer blanks the page while the new list loads. Find in Conversation opens in the conversation's top row instead of pushing the messages down. Copy, Edit and Remove show when the pointer is over a message or focus is inside it, and always on a touch screen. Removing your message now keeps Magnus's answer readable, though Magnus no longer reads either one.
- A matter's Conflicts tab reads like a conflicts check now. Review the latest check's results without leaving the matter, and see every check filed on it. The Parties tab is a table that tells you who the latest check searched and who was added since. On a counsel's row it names their firm, and one press adds that firm to the matter so the next check covers it.
- Joining or starting a meeting now opens its short nine-digit address straight away, such as /meeting/482-917-305, rather than a long one that changed after the room opened.
- **Fixing a name no longer leaves the old spelling behind.** Edit Name on a Directory record now replaces the name, as you would fix a typing mistake, and the old spelling is no longer listed as a former name. To keep an old name findable, such as a maiden name, add it with Add Other Name.
- **Labels read the same everywhere.** The small labels over a record's details used to be tiny capital letters, while the labels in forms were ordinary words. They now match, so a detail looks the same on the record and in the window where you edit it.
- **Adding a person and looking at one now look the same.** The photo sits at the top left of New Person, as it does on a record, and the heading shows the name as you type it. On a record, Edit Name and Add Other Name open right inside the Names section instead of a separate window. On a phone, the record and New Person windows now use the full width.
- **Calmer lists and sidebar.** Table headings and the sidebar's section names are now written normally instead of in spaced-out capitals, record titles in lists are no longer underlined until you point at them, and the line that shows a list scrolls further is grey instead of gold. Statuses such as Active or On Hold show as a coloured dot beside the word instead of a coloured pill.
- **Clearer conflicts screens.** Conflicts checks, results and settings use shorter, plainer wording, and the firm's required search scope is now called the "minimum".
- **Clearer directory screens.** Messages on people and organization records are shorter, and merging two records says "merge" throughout.
- **Clearer exhibits and reports.** Exhibit and report messages are shorter and plainer.
- A report's PDF is now made on your own device, so it no longer waits on the document service and works even while that service is starting up. Wide reports print in landscape, and every page is numbered.
- Report PDFs now open with the report's totals across the top of the first page, print each table's total in bold under a darker rule, and step a client's matters in under their client.
- **See what each feature depends on in System Status.** Settings, System Status now lists every feature beside the services it needs, whether each one is working, and which version is running, all on one tab. Outside services such as Google Calendar or Telnyx say whether they connected, whether their key is set, or whether they still need setting up.
- **Type dates the way you say them.** Every date field now takes "Nov 13", "11/13", "today", "tomorrow", "fri" or "last fri", and shows the date in words, like "Fri, Nov 13, 2026", once you move on, so you can see it landed on the right day. Up and down arrows move a day at a time, and the calendar button still opens a month to pick from.

### Fixed

- **A table's Columns list stays open while you choose several columns.** You can tick and untick as many columns as you like, including the one whose heading you right-clicked, and the list closes when you press Escape or click elsewhere.
- **Magnus gives real answers.** Production had been answering every question with test text ("[stub inference] ..."), because the switch that connects Magnus to its model was missing from the deploy configuration. The switch is now part of every deploy, and a deployment without it says the question was not answered instead of giving made-up text.
- Your camera uses less of your internet upload in a meeting: at most about 1.7 Mb/s, and only a small fraction while you are alone in the room. Copied connection diagnostics now say "full size" rather than "layer f".
- In a meeting opened in its own tab, the mark that shows you are speaking now lights after your first click in the meeting, and the browser no longer warns that sound was not allowed to start.
- **The Tasks board is readable again.** Its columns were squeezed to a sliver; they now share the
  width of the screen, and a list with more statuses than fit scrolls sideways inside the board. An
  empty column says No tasks. On narrower screens the buttons beside a page's title move beneath it
  rather than covering it.

## 2026-11-13

### Added

- **Turn on recording, summaries and captions for your firm's meetings.** A new page in **Settings**,
  under **Practice › Meetings**, is where a firm's owners and administrators decide whether meetings
  can be recorded, whether recorded meetings are summarized, whether live captions may be shown, and
  how many people one recording hears at once (up to eleven, as many voices as the recorder can hold in
  memory). Every switch starts off. Each one says what it does: a recording is announced to everybody
  in the meeting and its audio is added to the matter, and a summary also needs the firm's AI processing,
  with a link to **AI and the Assistant** saying whether that is on. Where the platform's recording
  service is not set up yet, the page says so beneath the recording switch, because no meeting can start
  a recording until it is.
- **Record a meeting, and everybody is told.** Where your firm has turned recording on, a member who may
  record can press Record in a meeting on a matter. Everybody in the room — guests included — is told the
  moment it starts, and anybody who joins while it runs is told as they arrive; the firm keeps a record
  of who was told and when. Stopping it is announced the same way.
- **Redact a PDF on a matter.** Open a PDF, choose **Edit PDF**, and drag boxes over what should be withheld, or redact a whole page. Give each one a reason, then apply them all at once. Magna Carta removes what is under each box, checks that it is gone, and saves a redacted copy beside the original, which stays as it was. It can also save a redaction log listing each page and reason.
- **Rebuild a search index that has fallen behind.** If **Settings › Data & Platform › Search and Indexing** shows Records as Behind, a **Rebuild** line appears beneath it. Click **Rebuild** and the records are read again in the background within a few minutes. Nothing your firm holds is changed. The page shows when the rebuild was asked for until it has finished.
- **A recorded meeting now has a written transcript beside its audio.** Once a recording is filed, its
  transcript is made from each participant's own microphone, so every line is attributed to the person who
  said it, guests included, and it says plainly where somebody could not be heard. The transcript is filed
  on the matter next to the recording as a captions file any media player can show. A transcript that cannot be finished is marked as failed with a reference you can
  give to support; the recording itself is never affected.
- **A recorded meeting is filed on the matter as one audio file.** When a recording stops, everybody's
  audio is mixed into a single WAV file and filed among the matter's documents, named after the meeting and
  the time it started, and checked like any other upload before it can be opened. A recording that cannot
  be finished is marked as failed with a reference you can give to support. Recording stays switched off
  until your firm turns it on.
- **Read a recorded meeting's summary.** Once a recording's transcript is ready, the Recordings list
  shows where its summary stands, and a ready one opens right there: a short account of the meeting,
  marked as the platform's characterization rather than a record of what was said, and the action items
  people agreed to, each with who it belongs to and when it is due. **Create Task** shows you the task
  and who it will be assigned to before anything is made, and lets you leave the owner's name off; the
  item then links to the task on the matter. When a summary was not written, it says why: summaries
  switched off, AI processing not switched on for the firm, or nothing said. Somebody who can host
  meetings can write a summary again with **Re-run**; tasks already made are kept.
- **Read a recorded meeting's transcript.** The Recordings list now shows where each recording's
  transcript stands, and a ready one opens right there: every line under the name of the person who
  said it, at its place in the recording, with a highlighted line wherever somebody could not be heard
  saying whose audio is missing and for how long. **Open Document** opens the transcript's captions
  file on the matter, and a transcript that could not be made shows the Error ID to give support. When
  that captions file has been moved to the trash or is held by the safety check, the transcript says
  it is withheld and why.
- **About Magna Carta now opens.** Choose About Magna Carta under Websites in your profile menu to see which version you are running, when it was released, who and where you are signed in, and your browser. Copy Version Details puts all of that on your clipboard for a support request, and the same window links to the Changelog, the full version report, service status and Report an Issue.
- **See who is calling.** When you type a phone number into a call or text record, Magna Carta now tells you what it knows about it: any contact in your directory who has that number, with a button to put them on the record, and the state or province the area code belongs to. Once your firm turns it on, a **Look Up Caller ID** button asks the telephone network for the name and line type behind the number. Each lookup costs a fraction of a cent, so it only runs when you press it, and the answer is kept so nobody at the firm pays for the same number twice.
- **Conflicts checks can now look through the text of your firm's files.** Files is on by default in New Check, with Consultations, Open, Closed and Archived (deleted files your firm still keeps). A result found in a file says it was found in a File and which matter it is on. Until your firm's file search is switched on, Files reads Not searched on the check, with the reason.
- **Conflicts checks now look through your firm's calls, texts, email, tasks and Magnus conversations as well as the Directory.** Each is on by default in New Check and can be turned off. A result found there says whether it was a call, text, email, task or Magnus conversation, which matter it is filed on, and when it happened, with a link to the matter. An email's body and your files are not searched yet.
- **A person or organization in the Directory can have a picture.** Press the circle beside the name at the top of a record to add a photograph or a logo, then drag and zoom it until it sits inside the ring. Only the square you choose is saved. Pressing the picture again lets you change it, view it full size or remove it. New Person has an Add Photo button too, and a downloaded contact card now carries the picture.
- **Legal Citations.** Paste a link to a statute, regulation or opinion, or a rough citation such as
  "347 us 483", and the details are read for you; anything you type overrides them. You get the full
  citation, the short form and the "Id." form in your court's format (Uniform System, Nevada or
  California), each ready to copy with its italics.
- Each Magnus conversation has a menu (the three dots beside its name). From it you can copy a link
  that opens that conversation directly, open it in a new tab, rename it, save it to a different
  matter, download the whole conversation as a file, or delete it.
- You can now edit a question you asked Magnus and ask again, or remove a question and its answer from
  the conversation. Removed messages stay on your firm's record until the whole conversation is
  deleted.
- You can now find words inside a Magnus conversation: choose Find in Conversation from its menu.
- You can now organize your Magnus conversations into folders and pin the ones you return to. Pinned
  conversations stay at the top of the list, and folders fold away when you do not need them.
- When you ask Magnus a question, you can now choose which model answers and how much effort it puts
  in. Your firm's model is still the default.
- **Blur your background or stand in front of a picture in meetings.** Open **Effects** in a meeting and choose **None**, **Blur** or **Image**. **Image** asks for a picture from your computer the first time and remembers it on that computer. The picture never leaves your browser: everyone else sees you in front of it, and nobody receives the file. This now works in any up-to-date browser, not only where the camera offers its own blur.
- **Invite a meeting guest by e-mail.** In a meeting's **Guests** panel you can now type a name and an
  e-mail address to invite somebody who is not on the list. If they are already in your Directory, the
  invitation goes to them; if not, they are added there for somebody to review.
- **Your own meeting room.** If you host meetings, the Meetings page now has a **My Room** card: a
  link that stays the same, so colleagues can join you whenever you are in without anybody scheduling
  a meeting first. Opening the room puts the meeting on your calendar, and **Move to a Matter** puts it
  on the right matter during the meeting or afterwards.
- **Stronger noise removal in meetings.** Under **Effects**, a new **Stronger noise removal** switch
  runs a noise filter on your own computer that takes out fans, typing and street noise more thoroughly
  than your browser does. It is off until you turn it on, uses a little more of your computer's power,
  and if it ever stops working your browser's own noise reduction takes over again.
- **Notifications can be grouped.** The list is grouped by day to begin with, newest day first, under
  headings such as Today and Yesterday, each with a count. **Group By** at the top of the list groups
  it by category, priority, matter or read state instead, or not at all. When you show your dismissed
  notifications, they sit under their own Dismissed heading at the end.
- **Rearrange the pages of a PDF.** In the PDF Editor's Pages tab, drag pages into a new order, turn them, or delete them, then save the result as a new version of the file. The version before it stays in the file's history. You can also save some of the pages as a new file, or split a document into several files at the pages you choose.
- **Say what happened on a call.** When you record a call, the new Activity choice says whether it was answered, transferred, a message taken or spam (or, for a call you made, connected, a voicemail left or no answer). You can also type the name the caller gave as their Caller ID.

**Taking a message puts it on your colleague's task list.** Choose Message Taken, pick who it is for, what they asked for, by when and whether it is urgent. Saving the call gives them a task such as "Call back Maria Lopez" and a notification.

**Spam calls warn you next time.** Mark a call as spam and say what kind; it is filed away without reaching the queue, and the next call from that number shows a Likely Spam warning with how many times the firm has marked it.

- **Tasks can repeat.** Turn on **Repeats** in a task to make it come round again, every day, week, month or year. Choose whether the next one appears when you complete this one, or on its own start date even if this one is still open. Only the current one sits in your list, and the next arrives with its checklist unticked and the same people on it.
- **Repeating events show on every day they fall on.** A weekly status conference now appears on each
  of its Tuesdays, not only the first. Changing or cancelling one asks whether you mean this event only,
  this and all later events, or all events in the series, and the repeat form now names the day the last
  one falls on.
- **Search every matter at once.** Type in the search box at the top of the window and choose **Search Every Matter For**. The Search page finds matters and people by name, and notes, time entries, costs, calls and file names on every matter you can see. Each result names its matter and opens there. The page also lists what it did not search and why.
- **Settings › Search and Indexing now shows what is indexed.** Under the Search Inside Files setting you can see whether your firm's records and files are fully indexed, how many files have had their words read, and a list of every place a search reads, with its counts. **Count Again** refreshes the figures.
- **Search only your own matters, or one client's.** The Search page has a new **Search In** row under the search box: **Everything I Can See**, **My Matters**, **One Client** or **One Matter**. My Matters and One Client search fewer matters, so an older note or time entry on them is found even when the firm has thousands of newer records with the same word. One Matter opens that matter's own search, which also reads the words inside its files.
- **Tasks can be shown as a board.** Choose **Board** at the top of the Tasks list to see one list's tasks as cards in a column for each status. Drag a card to move it along, or onto **Mark Complete** to finish it. While you carry a card, the columns it cannot move to next fade, so you can see where it can go.
- **Comments on tasks.** A task's window now has a **Comments** tab for talking about the work. Type **@** to name a colleague and they are told; the people assigned to the task and watching it are told too. You can change or delete your own comments.
- **Watchers and teams now hear about their tasks.** Watching a task now works like being copied on a letter. You are told when you are added, and again when the task is marked complete or reopened, changes status, is given to different people or has its due date moved. Assigning a task to a team tells everybody on that team.
- **Watch videos without downloading them.** Open a video on a matter's files and it plays in a new tab;
  select it and it plays in the details panel too. Step a frame at a time, jump ten seconds, change the
  speed, and copy a link that opens the video at the exact moment you are on. A video your browser
  cannot play, such as the format many phones record in, says so and offers the download.

### Changed

- **More detail about where a number is from.** The line under a typed phone number now names the town the number was issued in, not only the state or province, and shows the current time there, so you can tell at a glance whether it is a sensible hour to call back.
- **The Changelog now shows every change, with where it landed in the app.** Each change is tagged with the parts of Magna Carta it touched, so you can filter to Matters, Billing or any other area and see when it last changed. Filter by kind of change or to only what members see, search the notes, and fold entries away to read titles only.
- A conflicts check's list of runs is now called History. To file a check that has no matter, press **Assign to Matter** at the top of the check, next to Print.
- **Conflicts checks find names in calls, texts, tasks and Magnus conversations faster, and regardless of accents.** José Ortega now also finds "Jose Ortega". A name is matched as whole words, so it is never found inside a longer word. If one name appears in more than 200 records of one place, the first 200 are kept and the report says so.
- **The conflicts check is easier to run and to read.** New Check asks only for the parties and shows each place it searches with what it covers there. A check's page has Report and Runs tabs; the report is split into Details, Status and Results, each of which you can fold away. Each result says how strong the match is, what matched and how it was reached, and you can filter results and record a review from the result itself. A running check can be cancelled from its Running badge.
- **The New Person form has more room.** The name, contact and address fields are wider, so a row such as an email address with its use fits on one line. The "May already be in the directory" list beside it is a little narrower.
- **More videos play without downloading.** Videos recorded on phones in HEVC, and MKV files, now play
  in the browser wherever your browser can decode them, which includes Safari, Edge and Chrome on most
  newer computers. If yours cannot, the player says so and offers the download.
- Magnus conversations are easier to follow. Questions sit on the right under the asker's name and
  initials, Magnus answers on the left beside its gold M, every message shows when it was sent and has
  a copy button, and the matter a conversation is kept on is named in small print under its title.
- **Choosing when an event happens is quicker.** Starts and Ends on the calendar's event form are now
  one field each, holding the day and the time together. Press the arrow at the end of the field to
  pick a day from the month and a time from the list beside it, or type straight into the field. Any
  minute works, not only quarter hours. The end date now starts out the same as the start date, and
  picking a start time sets the end an hour later, so a one-day meeting takes one answer. **All day**
  is the first choice in the Starts list of times.
- **Entering a person is quicker and calmer.** Typing a United States ZIP code first now fills in the city and the state. Fields with a mistake turn red instead of printing a message that pushes the form around; hover over one to read what is wrong. A person's other names (a maiden name, an alias) open with every name field, prefixes and suffixes included, through an Add Other Name button, and addresses, identifiers and organizations each start as an Add button so the form shows only what you use. Several prefixes or suffixes now all show in the box as you pick them. The country is the last line of an address and starts as the United States, and a contact's or address's "Use" is now called "Type".
- **A cleaner player, screenshots, and sound files that play.** Videos now fill the page with the
  controls over the picture, out of the way while you watch. The settings cog holds the speed, the
  link to the current moment, and a new Save Screenshot. Voicemails, interviews and other sound files
  now play in the browser too.
- **Recording a call starts with the phone number.** Press Call or Text and Incoming or Outgoing, type the number, and write your notes straight underneath while you are still on the line. When it happened is filled in as now; press Change if it was earlier.

**The window looks the number up for you.** The new Identification side shows who the number belongs to and their open matters, with a search when there are many, and File Here puts the call on the right one. The History side lists every earlier call and text with that number.

**A second call no longer means losing the first.** Press Another Call to write down a new one; every call you are recording is listed down the left of the window, and saving one leaves the rest. Start An Intake is now in the More menu at the top right, and it only saves the call you are on.

- **Searching a matter now matches whole words in notes, time, costs, calendar and messaging.** Type several words and a record is found when it contains all of them, wherever they fall. The last word you type can be the start of a word, quotation marks find an exact phrase, and capital letters and accents no longer matter. A fragment from the middle of a word no longer matches in those sections. File names, party names, custody numbers, invoice numbers and telephone numbers are still found by any part of them.
- **Screenshots and converted videos are saved to the matter.** A screenshot from a video is now saved
  in the same folder as the video, and it carries the recording, the moment, the matter and who took
  it inside the picture. A video your browser cannot play now offers Convert to MP4, which saves a copy
  every browser plays beside the original.
- **Search highlights the words it found.** In a matter's search and on the Search page, each result now highlights the words that matched, and a long note or time narrative is shown at the lines where your words are instead of from its first line. A word found by its beginning is highlighted whole: type "ease" and "easement" is marked.
- **Favorites are now saved from the page menu.** The star beside each page's title has moved into the menu next to it: choose Add to Favorites there, and on a page you have already saved the same entry shows a gold star and reads Remove from Favorites. Everything you had saved is still in your sidebar.
- **Comments beside the task.** A task's comments now sit in their own column on the right of the task window, always in view, instead of on a tab.
- **Tasks has a new list and a new task window.** Each task list has its own coloured statuses: press a task's status to move it, or to mark it complete. Start dates, due dates and priority change right in the list, and a past due date shows in red. Tasks can have sub-tasks, several assignees (including teams), watchers, a checklist, links and a location with a Join button for meeting links. Me Mode narrows the list to the tasks assigned to you, the ones you are watching, or both. View lets you show one or two lines per task, choose the row size and hide columns, and Group By groups the list by list, status, due date, person or matter. People who manage task plans can set up lists, statuses and teams under Task Settings. Every field in a task's window is edited in place, without an Edit button.
- **Searching inside files can now be turned on.** The platform's search service is connected. An Owner or Administrator can turn file indexing on under **Settings › Data & Platform › Search and Indexing**; after that, a matter's search also finds files by the words inside them and quotes the passage it matched. A conflicts check that asks for Files reads **Not searched** until then, and says why.
- **A dropdown you can type in now opens its list when you click or tap the box.** You no longer have to aim for the small arrows. Tabbing into the field still leaves it closed.

### Fixed

- **Meeting recordings are more dependable.** Somebody whose connection drops for a moment is heard at
  the right point in the recording. Long recordings are filed instead of failing, and a recording opens
  from the meeting only once its file has been checked. If a recording was filed without somebody's audio,
  the list says so and gives a reference for support.
- **Anonymous polls keep your choice private in one more place.** When you answer a poll that does not
  show names, nothing the system keeps to handle a repeated tap can be used to work out what you chose.

**Live counts in polls and the question queue no longer jump backwards** when several people answer
or upvote at the same moment.

**Rejoining a meeting while your camera was still connecting works first time**, rather than showing
a connection error until you tried again.

**The question queue is steadier.** A question that has been taken back can no longer be upvoted,
two questions asked at the same instant both appear, and pressing upvote repeatedly can no longer
slow the app down for your colleagues.

- **Checkboxes and radio buttons on a PDF form template work after the template is cleaned.** Uploading a fillable form clears whatever the last person typed into it. That cleaning also removed the drawings of the ticked and unticked boxes, so a box you ticked could come out unticked on the finished document. The boxes are now kept and reset to empty.

**Long PDFs are searchable in full where the built-in reader handles them.** That reader stopped at 100 pages and reported the document as unsafe. It now reads documents of up to 50,000 pages.

**Numbers with repeated narrow digits are found by search.** A year such as 2011 could be indexed as "201 1" in documents set in Helvetica or Arial, so searching for it missed the page. Word spacing is now measured the way the document itself spaces its letters.

- **Long scanned documents are now searchable.** A scanned PDF of more than 100 pages used to be skipped entirely, so none of its pages could be found by search. It is now read from the first page to the last, up to 50,000 pages.
- **Screen readers and voice control now say the words a control shows.** A folder in the file tree
  is named with its file count, a small calendar's month heading starts with the month it shows, and
  the Error ID on a failure message reads the ID and what pressing it does, so you can say what you see.
- **A group in the sidebar, such as Internet, opens and closes again while the sidebar is collapsed to icons.**

## 2026-11-09

### Added

- **Record when a matter's paper file may be destroyed.** Closing a matter now asks about its paper file: choose **Destroy After** and a date, or **No Destruction Date**. Your firm can set a minimum number of years under **Settings › File Retention** (Owner and Admin only); a close then refuses a date earlier than the close plus that minimum, and opens on the earliest allowed date. A later date, or none, is always allowed. On a closed matter the date can be changed afterwards from the status window, and reopening a matter clears it. Magna Carta never works the date out for you, since retention periods depend on your jurisdiction and your firm's policy, and it never destroys or deletes anything when the date arrives. It is a reminder: the dates appear on the calendar under **Dates, File destruction dates**, and every change is kept in the matter's audit history with the date it replaced.
- **Partner and Associate, as kinds of Attorney.** Every firm now has two sub-roles under Attorney. A
  Partner or an Associate can do everything an Attorney can and counts as an attorney everywhere.
  Partners can also see the firm's financial and productivity reports and every timekeeper's time,
  approve time and costs, and reopen a closed matter. A rate card can give Partners and Associates
  their own default rate, and a rate set for one person still wins. On Users, ticking Partner ticks
  Attorney too, and a member holds one of the two. The Owner/Admin role is now called Admin, and
  anybody can hold it alongside any other role.
- **See what changed, inside Magna Carta.** Choose your avatar at the top right, then **Websites** and **Changelog**, to read every change made for you, newest first and grouped by date. Filter to Added, Fixed or another kind of change to find what you are looking for. The changelog comes with the version you are using, so it only describes what you actually have.
- **A Directory record can be shared or saved as a contact card.** The three-dot More button at the top of a person's or organization's record now offers Copy Link, Email Link, and Download Contact Card. The contact card is a .vcf file that phones, Outlook and other address books open. It holds the name, a person's date of birth, and the ways of reaching them that the person allows the firm to use, and leaves off identifiers, matters and anything recorded as former.
- **Every page has a menu beside its title.** The three dots next to the star let you copy the page's link or open it in a new tab, and some pages add their own entries there: What You Hear About on Notifications, Postage Account on Shipping & Postage, and Clear History on Uploads. The star stays where it was, so you can still see at a glance which pages are favorites.
- **Choose the typeface you read in.** Settings · Text now lets you set the interface in Atkinson Hyperlegible, Lexend, OpenDyslexic, Literata or your computer's own font. It applies at once, follows you across your open tabs, and is yours alone: it never changes what anyone else at your firm sees.
- **Version History now says who changed what.** For a Word document edited in the browser with recording on, each version reads "Ana Vasquez: 3 added, 2 removed · Trevor Goldsmith: 1 reformatted", naming the person who typed the words rather than the person who pressed Save. Open a version's changes and the words appear in order with their author: additions underlined, removals struck through. A version lists only what is new in it. Uploaded documents, spreadsheets and presentations carry no such record.
- **A Directory record can be downloaded as a PDF or a text file.** The More menu on a person's or organization's record now has a Download option with three formats: PDF, Plain Text, and Contact Card (.vcf). The PDF and text file are a printout of the record, including its names, dates, contact details, addresses, relationships and matters. Contact details the person asked the firm not to use are marked. Sealed identifiers such as a social security number never appear in the printout.

### Changed

- **The calendar is easier to read and to move around.** The month you are reading is now the heading over the calendar; press it to jump to any month. **Today** and a single **View** menu sit at the top right. The firm's calendars on the left are now **Case Settings**, **Deadlines** and **Firm Events**, each with its own colour and tick, which replaces the separate Kinds filter. The small month under the list is smaller, has its own arrows, and picks a month from a grid instead of a dropdown. The month view shows only the weeks the month needs and no longer scrolls when there is nothing more to see. A deadline's Source now reads **Court Order** or **Firm**.
- **Every number your firm issues is now yours to shape.** Invoice numbers, time entry numbers and call and text reference numbers join matters, consultations, intakes, conflicts checks and custody packets under **Settings, Numbering** — eight sequences, each built from the same parts. Nothing you have already issued changes: each one starts out rendering exactly what it rendered before, and only changes when you change it. Two new parts came with them, **Month** and **Day**, and time entry numbers can carry the **Matter Number** they belong to.

**The numbering screen reads as a list again.** Each sequence is now a fold, closed by default, with its current number shown on the heading — so the page opens as a summary of all eight and you open only the one you want. The stray second scrollbar is gone — on this page and on every other settings page, where the whole page could be nudged a short way beside the list's own scrolling — and the table fits beside the settings list on any screen 1220 pixels wide or wider, so the controls at the end of each row are always in view. In the parts table, **Move Up**, **Move Down** and **Delete** sit together at the end of each row, the parts offered are in alphabetical order, and a cell you cannot type into now shows you what it will fill in instead of leaving you guessing. **In Force** now reads **Current**. The ready-made shapes moved under **Load an example**, because they were never the only shapes available.

**One thing to check if you bill on more than one letterhead.** An invoice number counts within the letterhead it is issued under, and that letterhead now has to appear in the scheme. If your firm has opened a second invoice numbering scope, add the **Office Code** part to the invoice scheme before your next bill on it; until you do, that bill is refused rather than given a number your firm-wide run could issue as well. The reverse holds too: once invoice numbers print the office code, every bill needs a letterhead, so leave the part out unless your firm issues under more than one.

- **Firm settings are tidier.** **Firm Profile** now holds just the firm's name, and the firm's logo and other brand images have their own page, **Settings › Firm › Firm Brand**. The list of offices no longer appears on Firm Profile, since **Offices** already shows it. **Rooms and Resources** moved from Practice to Firm, and each resource's **Change**, **Retire** and **Restore** now sit in a **...** menu at the end of its row.
- **A person is entered and read on one scrolling page.** New Person and a person's record now show every section on one page that scrolls, and the list down the left side jumps between them and highlights the section you are in, so a name, a phone number and an address are entered or read without switching sections, and Tab moves through every field. Pronouns and dates share one About section. While you enter a new person, the right side shows the entry as it will read, such as the email address itself, and the button says Save. A record shows a person's pronouns and dates under their name, keeps its right-hand column for the roles they hold on the matter you opened it from, and shows the first few lines of a long list with Show All.
- **Pages open faster, and show their loading placeholder less often.** Most screens no longer wait to re-check who you are before asking for their own data, and going back to a matter you just looked at opens it straight away.
- **The current AI models, and only those.** Under **Settings, AI** (renamed from AI and the Assistant), you choose between **Claude Opus 5.5**, the platform's new default in place of Claude Opus 4.8, and **Claude Sonnet 5.5**, listed by name. Older models are no longer offered: if your firm had chosen one, it now uses the platform's model, and you can choose again on the same page. The page also lists the effort levels each model accepts, from low to maximum. Every model on the list still keeps nothing your firm sends it and never trains on it.

**The page can check Anthropic's own list.** Where it is set up, a new **Provider's Live List** row says when Anthropic's list of models was last read and names any newer model that is not on your list yet, so you can see what exists before it is verified and offered.

**One scrollbar.** The AI settings page no longer shows a second scrollbar beside its own.

- **A conflicts check says who ran it and who it searched.** A check's report names the person who ran it, the check page lists the parties searched by name, and the conflicts log shows them in a Parties column. A check not filed on a matter now reads No Matter.
- **Notifications is now a table you can sort and filter.** Narrow it from the column headings (unread,
  category, priority), mark an item read with the check at the start of its row, and dismiss what you
  are finished with. Dismissed items are no longer mixed in with the rest: **Show Dismissed** at the
  foot brings them back into view, and **Restore** puts one back in the list. The bell now shows the
  most urgent items first.
- **Client codes can be numbers, and matter numbers need no padding.** A matter numbering scheme of Client Code, a dash and a Counter, with Separate Count on for the client code, gives client 3333's matters `3333-1`, `3333-2` and on through `3333-10`, while client 4444's start at `4444-1`. A new counter is written with no leading zeros; set its fewest digits to 4 if you want `0001`. Lists now sort numbers the way you read them, so `3333-2` comes before `3333-10` in every table.

**Choose how dates and client names are joined.** **Date Numbered** and **Client Name** now have a separator: Dash, Period, Underscore, Tilde or None, so a date can read `2026.11.11` and a name `Ashford-Holdings`. Schemes you have already saved keep the shape they have.

**The numbering editor is simpler.** **Preview** now sits directly under **Current**, so you can compare the two at a glance. Drag a part by its grip to move it, or focus the grip and press Alt with an arrow key. **Restarts the Count** is now **Separate Count**, the **Digits** column is now **Format**, the Part list shows what each part would put into the number, and **Add Part** is a quiet line under the last part. **Load an example** has been removed.

### Fixed

- **Recording a deadline is clearer about what it needs.** The time field now takes only a time of day, and a time left half-typed is pointed out beneath the field instead of being saved as "end of day". The matter list on the deadline form no longer offers **No matter**, because every deadline belongs to a matter; pick the matter it is due on.
- **Meetings appears under Communications.** Anyone allowed to join a meeting now sees Meetings in the sidebar and can find it from the command palette. Before, it was hidden from everyone.
- **You can save a packet even if your firm has never set up its storage.** The Container field on New Packet lists every open container by its full path, and you can type to narrow it. If the container you need is not there, type its name and choose Add: say what kind it is and what it sits inside, and it is ready to use. The first time your firm logs a packet, the form opens straight onto this. The form now asks for the name, who it is held for and the container first, and its button reads Save.

## 2026-10-02

### Added

- **Start a call, not just a meeting.** A calendar entry now offers **Start call** beside **Start
  meeting**. A call is the same room and the same record — who was in it and when — with sound only:
  no camera, no screen share, and each person appears as their name rather than a picture. Everyone
  else sees **Join call** in the same place, so nobody has to work out which kind it is.

**Whoever starts it decides which it is.** A call stays a call for everyone in it; nobody can turn a
camera on partway through. If you want video instead, end the call and start a meeting.

**Coming back after a dropped connection works properly.** Reconnecting — or opening the meeting in
a new tab — now hands the room over cleanly, so your colleagues see you again instead of a tile that
never loads, and the old window tells you it has been taken over rather than going quiet.

- You can now keep everything the Safe Website Viewer found, not only its picture. **Download Screenshot and Details**, above the screenshot, saves one ZIP holding the screenshot, a plain-text report of every tab on the right — overview, redirects, page text, links, headers, and the registration record when you opened it — and the same facts in a structured file. Nothing in it is live: the site's addresses are written as text, never as links.
- **Consultations now get a file number.** A consultation is given a number the moment it is recorded — `C2026-0001` unless your firm sets its own shape — so there is something to write on an intake sheet or a conflicts check straight away, instead of the word "Consultation" where a number belongs. It comes from its own sequence, so a consultation that never becomes a matter does not use up one of the firm's matter numbers.

**Opening the matter adds its matter number; it does not take the consultation number away.** The docket and the matter header show the matter number from then on, and the consultation number stays on the matter's own page — so anything filed or quoted under the tentative number still finds its way back. Searching the docket finds either.

**Recording a consultation works before the firm's numbering is set up.** Consultations number themselves from a built-in sequence until an administrator sets the firm's own, so a file can always be taken down while the numbering is still being decided.

- **What you send out shows the finished text, not the edits.** A document edited in the browser keeps a record of who changed what, and that record stays in the document for as long as it lives. A copy that leaves the platform does not carry it: downloading the document, or a bundle that holds it, hands out a copy with every change accepted, so the other side sees the text and nobody's redlines.

The copy is made moments after each save. Download in that same moment and the download waits for it; a bundle of several documents saved that instant may ask you to try again shortly. A document too large for the copy to be made downloads as stored, and the firm's audit trail records that it did.

- **Export straight to Excel.** Download Report now offers a real Excel workbook: each section on
  its own worksheet with its headings pinned, and every count a genuine number, so you can sum and
  sort your figures instead of fighting text that looks like numbers.
- **When a screen fails to draw, you now see the failure screen instead of a blank page.** It carries an Error ID you can quote, the details you can copy, and the Reload and Report a Problem controls, the same as every other failure in Magna Carta. Nothing is sent unless you choose to report it.
- **Open a document and start working on it.** Double-click a Word document, or a plain-text file
  such as a `.txt` or `.md`, on a matter's Files page and it opens in a new tab ready to edit. Word
  documents open in the full browser editor; text files open in a simple editor with a **Save New
  Version** button, and every save is kept as a new version alongside the ones before it. Everything
  else still opens its preview.
- **Flat charges are now recorded the way your hours and your costs are.**

A fee is a flat charge for professional services — a settlement drafting fee, a fixed amount for a
document, anything you agreed as a number rather than metered. Record it on the matter's **Fees**
section with its date, who it is for, what it covers and what it comes to. It saves as a draft, it
appears on the matter's fee record straight away, and a draft bill takes it up the same way it takes
up a cost.

**A fee is never worked out from your time.** The amount is what you decided to charge. If your
matter is billed hourly, your hours still bill as hours; a fee recorded here is a separate charge
beside them.

The section shows **every fee on the matter in every status** — drafts, anything waiting on review,
what has been approved, and what a bill has already taken up — with two figures underneath: what is
still unbilled, and what has been billed. A billed fee opens the bill it was charged on.

Two ways to take a fee off the ledger, and they are different acts. **Delete Draft** removes a fee
nobody has been shown; it does not come back, and there is no record to preserve. **Void** withdraws
anything further along: the fee freezes, stops counting toward every figure, and stays on the record
struck through, because it is something you may be asked to account for.

**Fees is now in the sidebar too.** It shows every flat charge across every matter for the days you
choose, the same way Costs shows what the firm laid out — where a month gets read back before
billing. Each row's matter is a link to that matter's own Fees section, and **New Fee** works from
there too: because the screen is not standing on a matter, the first field is the matter, and nothing
is pre-filled.

New guide: [The firm's fees](user/features/the-firms-fees.md). Updated guide: [A matter's money
sections](user/features/matter-money-sections.md).

- **Your firm can connect its postage account and use it** — compare rates, buy a label, track the parcel, and refund one you did not use. Postage lands on the matter as a recoverable cost, as it always did.

Whoever does your mailing can do this without being given the keys to everything else your firm has stored. If someone may create shipments but has not yet been allowed to use the postage account, they are told exactly that, and which permission to ask for.

Drafting a shipment never required the account and still does not.

- **A firm can decide what its own people may do.** Settings · Users is the roster: invite a colleague and name the role they arrive holding, change what somebody holds when their job changes, and withdraw a member's access without erasing them — they stay on the roster, still the responsible attorney on the matters they carried and still the author of what they filed. Settings · Roles and Permissions states what each role actually allows, area by area, so a role can be read before it is given.

Two rules are enforced whatever screen you use. Nobody changes their own roles or takes away their own access: giving up your administration is something you ask a colleague to do, which leaves a record of who did it. And a firm always keeps somebody who can administer it.

Every firm settings page also now tells you the truth about whether you may edit it. That standing used to be fixed regardless of who was signed in; it is your own now.

- **Your firm can now turn AI on, and decide separately what may use it.** Under Settings, AI and the
  Assistant carries two switches. The first says whether your firm's content may be sent to an AI model
  at all — nothing is sent to any model while it is off. The second says whether Magnus, the in-app
  assistant, is one of the features that may send it, so turning the assistant off leaves the rest
  alone. Both are off until you turn them on, and the page tells you in a sentence what will actually
  happen once you save.

Beside them the page states which model your content reaches, the exact release behind any answer, and
two guarantees about it: the provider keeps nothing that is sent to it, and never trains on it.

You can also set how many questions your firm may ask the assistant in a day, so the assistant cannot
run up a bill nobody chose. Only owners and administrators can change any of this; everyone else can
see where the firm stands. Every change is recorded, with who made it and when.

- **Your firm can now set its own notification policy.** Three things that were fixed for everybody are
  now yours to decide:

- **Which categories every member hears in app.** Turning a category on for the firm means nobody can
  switch it off for themselves — useful for the kinds of notice a practice needs its staff to see. It
  works one way only: your firm can insist a category reaches people, and cannot stop somebody hearing
  about their own work.
- **How long notifications are kept.** Anywhere from thirty days to a year. A shorter window is not a
  loss of the record — the matter timeline and the audit log keep their own — but it does decide how
  far back somebody returning from leave can scroll.
- **What time the daily and weekly summary emails go out**, in your own office's local hour rather
  than at a time the platform picked.

**Email stays the member's decision.** Your firm can set a default cadence, and can never raise
somebody's — a summary is a copy in a mailbox your firm may not administer, so the more private of the
two choices always wins.

**It is an administrator's setting, not a personal one.** Only Owner/Admin seats can read or change
it, and every change is recorded in your firm's audit log with what was changed and who changed it —
never anybody's name beyond the person who made the change.

The screens for this are still being built; what the settings mean is described in
[Notification emails](user/features/notification-emails.md).

- **A firm can record a client's telephone number.** It could not before. `directory_email`,
  `directory_phone` and `directory_address` had been in the schema since the baseline migration with
  nothing able to write to them — phone and address had no domain module at all, and email had one
  reachable only from inbound mail capture — so a record screen listed seven panes and none of them was
  Contact. That is what this change fixes, and the rest of it is the shape the owner asked the record to
  hold.

**A record now has a Contact pane** carrying email addresses, telephone and fax numbers and postal
addresses, more than one of each, with one default per channel.

**A contact point says whether the firm may use it and whether it is preferred, and those are two
different facts.** A person is routinely reachable at a number they would rather nobody rang, and
routinely asks to be written to while their email address stays perfectly usable. So a number the firm
was told not to use is recorded with the permission withdrawn and the reason beside it, rather than
deleted — deleting the number loses the instruction along with the value, and the next member types it
back in from the same letter and rings it. At most one contact point per record is the preferred one,
across all three channels together, because "write to me" is one answer about every channel.

**A fax is a fax by what answers the number, not by a word in a label.** What technology answers a
number and what context it is used in are separate, so a work fax is expressible and a delivery path
asking "may this be faxed" gets an answer instead of a string. The number is stored exactly as it was
written and is never reformatted; the split into country calling code, national number and extension
sits beside it and goes empty where the number could not be split, so a number written in a way no
parser expects is still recorded and still shown.

**An address is an address anywhere.** Which fields a country uses, what a reader there calls them and
what order they read in all vary, so the fields are the international set — recipient, organization,
two address lines, district, town, region, postal code, sorting code, country — and none of them is
required. Nothing assumes a state and a five-digit postal code, and an address the firm holds only half
of is stored as the half it holds rather than refused into a free-text note.

**Returned mail has somewhere to live, and it warns rather than blocks.** A contact point records what
the firm found the last time it tried to use it, including the carrier's own words when a letter came
back. A failure is shown beside the address and never refuses a send: a bounce is frequently temporary,
and a platform that refuses on a stale failure teaches its users that its warnings are noise.

**A date of birth is a date again.** It had been filed with the sealed identifiers — the social
security numbers and the driver's licences — which match only by exact index; a date of birth is too
low-entropy to index safely, so the code deliberately refused, and a firm could store one and then ask
it nothing. Every question a firm actually has about a date of birth is a range: is this client a
minor, has a limitation period tolled, whose birthday falls this month. It is now an ordinary
attribute of the person and those questions are answerable. Date of death came with it, against the
decedent field that has been pointing at nowhere since it was written, with a separate flag for the
state probate work meets constantly — known to have died, date unknown. Values already sealed under the
old date-of-birth type stay readable; nothing new is written there.

**No third party sees an address.** The owner asked what a mapping or address-validation provider would
buy. The recommendation, with the measured options and costs, is recorded as a decision rather than
adopted: a client's address leaving the firm's tenancy is a privacy decision the owner makes
explicitly, so this change ships the seam a provider drops into and no provider.

- **Your firm's own fields now go on an asset.** The fixed kinds and your firm's own type list cover
  what a thing **is**; a timeshare's week number, a boat's slip number, or who valued a piece of
  jewellery is a fact **about** a thing, and until now there was nowhere to put one. It is the same
  feature you already use on matters and on contacts — the same field types, the same administration
  screen, the same rules.

Attach a field to one kind of thing and it appears there and nowhere else: "slip number" on vehicles
shows on the boat and not on the house. Attach it to nothing and it appears on every asset.

Everything that is already true of a firm-defined field is true here. Renaming one never loses what
was recorded in it, because a value is tied to the field itself rather than to what it is called.
Archiving one keeps every answer already recorded and stops it appearing on new records. Deleting one
outright is still refused once anything has been recorded in it.

Two limits worth knowing. **A firm-defined field is ordinary stored text, not a sealed one** — an
account or policy number has its own handling on the asset record, and a password, recovery phrase,
or safe combination has no home in the register at all. And **an asset field is not yet a merge
field**: a firm-defined field on a _matter_ can fill in a document, one on an asset cannot, because
an asset field would have to print once per asset inside a repeating block and that is a separate
piece of work.

- **A fillable PDF your firm already has — a court form, an agency form, your own intake sheet — can now
  be registered as a template, and the same merge fields that fill a Word letter fill its boxes.**

Upload it as a fillable PDF instead of a Word document. Everything else about a template is the same:
the same catalogue, the same version history, the same record of which version produced which document,
and a filed PDF that lands in the matter's documents like any other file.

**Nothing is guessed about what a box means.** A Word template tells us what its blanks are because you
typed them; a form carries only the name whoever built it gave each box — `Petitioner_Name_1`,
`TextField12`, sometimes nothing recognisable. So registering a form lists every box on it — what kind
it is, which page, whether the form marks it required — and you say which merge field fills each one.
What you say is remembered for your firm, so the next form using the same box names arrives already
filled in. Where a box's name happens to be exactly a merge field's, that is offered, and still only
offered: a box called `ClientName` is not turned into the client's name because it looked close. That is
a decision about a client's details in a document you are about to file, and it belongs to you.

**Every box is accounted for, and the ones nothing fills in are named** — boxes with no merge field
chosen, buttons and signature boxes, and boxes the form declares without saying what type they are. Each
is listed with the reason at registration, in the field list, and again on every document you assemble,
which is marked as needing review. A form that binds nothing at all says so plainly rather than quietly
producing the blank form every time.

**Anything already typed into the form is removed when it is stored.** Firms upload the copy they last
filed, and a template still carrying the previous client's answers is the last thing anyone wants.

Missing values behave exactly as in a Word template: the same visible `[CLIENT ADDRESS]` marker inside
the box, the same report, and the same stop when a field is set to require an answer. A tick box and a
drop-down have nowhere to print a marker, so they are left unanswered and the report says which box and
why — ticking a box to mean "we do not know" answers the form's question wrongly, which is worse than
leaving it for a person.

A document built from a form keeps its boxes, so whoever receives it can still correct a typo or
complete what you left for them.

- **Your downloads now have a home.** Anything the platform makes for you — a report you exported, a
  bundle of files — gathers under **Downloads** in the sidebar for a week, so you can take it again
  without running it a second time. Each row shows what it is, when you made it, which formats you have
  already taken, and when it stops being available. An exported report can be taken again in any
  format, not only the one you chose first, and it holds the figures exactly as they were when you ran
  it. Clear anything off the list whenever you like.
- **Put your hand up.** Raise your hand and everybody in the meeting sees it — and whoever is running
  the room sees who is waiting, in the order the hands went up, so the floor goes round in turn instead
  of to whoever speaks first. Lower it yourself, or let the host lower it when it is your turn.

**Say what you think without interrupting.** Six reactions — agree, disagree, thank you, that is
funny, well said and congratulations — appear on your tile for a few seconds. In a large meeting they
are gathered into a count instead, because "eleven people agreed" is the thing that is actually true
when three hundred people are listening.

- **When a candidate surfaces that your firm has answered before, the screen tells you.**

Opening it shows what was decided, when, and a link to the check where it was decided — and the
candidate stays unanswered, waiting for you.

That is deliberate. The same company can come up twice for genuinely different reasons: once as a
former client you are free to act against, and later as the subsidiary of a client you act for
today. The second question is not the first one, and the platform will not answer it for you by
quietly carrying the earlier decision across.

You get the history. The judgment stays yours, and the record says whose it was.

- **You can see every answer a hit has ever had.**

Opening a candidate showed the most recent decision and nothing before it. It now shows the whole
history in order — who answered, when, what they said, and for a waiver what the firm holds to
evidence it.

That history is the point of the record. An answer is never edited: a reviewer who changes their
mind records another, and both stay on the log, so the sequence a firm is asked about later is the
sequence it can produce.

A candidate nobody has answered says so plainly, rather than looking like one with nothing to show.

- **A locked PDF asks for its password instead of refusing to open.** Open a password-protected PDF from a matter's Files page and the reader now asks for the password directly — type it and the document opens, checked without ever leaving your browser. Get it wrong and you can try again; don't have it at all, and the reader points you to File Unlock & Password Recovery in Tools, which can search for a common or predictable one.

**File Unlock & Password Recovery, in the Tools sidebar, now actually works.** Drop in a password-protected PDF, ZIP, or Word/Excel/PowerPoint file: unlock it with a password you have, or start a search for one you have lost. A search you start opens its own page you can leave and come back to — it keeps running, you can check its progress, and you can cancel it any time. A password it finds is shown once, so copy it right away.

- **You can record which office a matter's paper file is kept at, and open that office from the matter.**
  Press the matter's status seal, choose Matter Status, and the Physical File panel's Location is now a
  link to the office record: its address, its telephone, who works there. Press Set Location to record
  it, or Change Location to move it — a file boxed at a records store is recorded where it actually is,
  not where the matter is run out of. Leaving it empty is a real answer: a firm that does not know where
  a folder is can say so rather than leave a guess on the record.

Held In and Destroy After are still marked Soon.

- **Change a matter's status by clicking its status badge, and see what closing requires before you try.** The badge at the top of a matter opens a short window: the matter's status, what closing requires, and where the firm's paper file is kept. Magna Carta checks the firm's own rules for you when the window opens and marks each requirement met or not — nothing there is yours to tick. Where one is not met, it names what is in the way, the account it sits on, and the ways to clear it, and the Close Matter button stays disabled until it is. That button sits beside the status itself rather than at the bottom of the window, so a window you opened to read something cannot close a matter with a press in the corner your hand goes to by habit. Beside it, the firm's own physical file: what it is held in, where that is kept, and when the file may be destroyed. None of the three is recorded yet, and it says so rather than leaving the questions off the screen. The panel sits beside the status rather than under the close because closing a matter does not move its file. There is also a back arrow to the matters list at the top left of every matter.
- Meetings now ask your browser to reduce background noise, cancel echo and level your microphone,
  and the Effects control beside the camera shows what your browser actually applied. Where your
  computer offers its own background blur, you can turn it on from the same place; where it does
  not, the control says so rather than offering something that would not work.
- **Ask the room.** Whoever is running a meeting can put a question to everybody in it — two to ten
  choices, one answer each or several — and watch the answers come in. A poll can be set so answers are
  not shown with names; everybody can still see how many have answered.

**Let the room ask you.** Anybody in a meeting can put a question to the host, and the rest of the
room can upvote the ones they want answered, so the most pressing rise to the top. The host marks each
one answered as they go, and anybody can take back a question they asked.

- **Invite a client, opposing counsel or an expert to a meeting with a link.** A host can send a
  one-time link to anybody in the Directory who is on the event. They open it, confirm their name,
  check their camera and microphone, and wait at the door until a host lets them in — a guest always
  waits, whatever the lobby setting. The host sees the name they typed beside the name the link was
  sent to, so a forwarded link is easy to spot.

**A guest sees the meeting and nothing else.** No matter, no calendar, no colleagues' accounts — the
room, the chat and the people in it by name.

**Links are yours to control.** Send a fresh link if one went to the wrong place (the old one stops
working at once), or withdraw it, which also removes the guest from the room. A link stops working a
couple of hours after the meeting ends.

- **Schedule a meeting or a call from the calendar.** When you record an event — on a matter, for the
  firm, or on a colleague's calendar — the Where tab now asks whether it is also a meeting: **Video
  meeting**, **Audio call**, or **None**. Choose one and the room is created with the event, so
  everybody on it sees **Join** straight away instead of waiting for somebody to press Start.

**Everyone at the firm on the event is invited**, and each of them gets a notification with a link
to the event. A client or another party from the Directory is not sent a way in yet — the form says
so under the choice, so you know before you send it.

**You can see who is already busy.** As you add colleagues to the Who tab, each name shows what is
already on their calendar at the time you have chosen. It never stops you booking — two things at
once is often exactly right — it just puts the answer where you are asking the question.

**Moving the event keeps the meeting**, and cancelling the event closes a room nobody has joined. If
people are actually in the meeting, cancelling the event is refused until somebody ends the meeting
— a calendar edit will not close a room you are sitting in.

**The Meetings page has a New Meeting button**, which opens the same form already set to a video
meeting. Guides: [Meetings](../docs/user/features/meetings.md) and
[Case calendar and deadlines](../docs/user/features/case-calendar-and-deadlines.md).

- **You can see how your connection is doing, and everybody else's.** A small set of bars sits beside
  each person's name on their tile and in the list down the side: four bars is good, fewer is worse,
  and an empty mark means nothing has been measured yet. Your own preview carries the mark too, and
  that one is about what you are sending — so when everybody says you are breaking up, you can find
  out whether they are right.

**Connection** in the control bar opens the numbers behind the marks: the size of the picture you are
sending, how much is going out, how much is going missing, the round trip, the same answer for each
other person in the room, and a short list of what has happened on your connection with the error
reference to quote if you report it. None of it is recorded — the measurements live in your browser
while the meeting is open and go when you close it.

- **What somebody types in a meeting now appears straight away.** Chat used to arrive on the next
  refresh; it now reaches everybody in the room as it is sent, and a message somebody takes back
  disappears from every screen rather than lingering until the next reload. Nothing about the record
  changed: the transcript is still kept with the meeting, and a removed message still leaves a note
  saying one was there.

**Somebody at the door cannot see the chat.** A person waiting to be let in receives nothing that is
said inside the room — that has always been the intent, and it is now the way the relay is built
rather than something the room remembers to check.

- **Matters now have Notes.** Write down what happened on a case that nothing else records: the phone call, the standing instruction, the reasoning behind a decision. A note is dated and attributed the moment you write it, and those never change.

**Correcting a note keeps what it said before.** Fix a typo or add what you left out, and the earlier version stays readable in the note's history, with the name of whoever wrote it. Nothing is edited over the top, because what makes a note worth having is that it was written then, by that person, saying that.

**Withdraw anything that should never have been written down.** Another client's privileged material, somebody's medical information, a note filed against the wrong matter. The text stops being shown everywhere, including the matter's activity history and search, while the record that the note existed, who wrote it, and who withdrew it stays with your reason in its place. Nothing is deleted, and your firm can see that a note came down and by whose hand.

**Notes stay inside the firm.** Clients never see them, and there is no setting that makes one visible. They are never merged into an assembled document, so a note cannot end up in a letter under your letterhead, and they are not swept into discovery review sets. Reading, writing and withdrawing are three separate permissions, so your firm decides who does each.

**Find a note again.** Search a matter's notes for what they say now. A note corrected to take out a name stops being findable by that name, which is usually why it was corrected; the earlier wording is still in that note's history.

- **PDFs open in the app, and text files are safer to edit.** Double-click a PDF on a matter's Files
  page and it opens in a new tab, ready to read: turn pages, zoom in and out, and download it from the
  same screen. Nothing is sent anywhere to make that happen, and the document is drawn by Magna
  Carta's own reader rather than handed to the browser's.

Text documents also got a guard. A file written in an older character set used to open with some
characters shown wrongly, and saving it would have stored them that way. Now it says so and offers
you the download instead, so a document cannot be damaged by opening it.

- **A person is recorded whole.** New Person puts every section of the record on one screen — names, ways to reach them, pronouns, dates, sealed identifiers and the organizations they belong to — as a rail down the left with the section you are on beside it, and shows on the right, as you type the name, the records the Directory may already hold for the same person. Everything is recorded together when you press Record Person, or not at all.

**Pronouns are a dropdown.** The sets most people state are offered by name; Another set opens the five forms.

**Contact is one line per way to reach someone.** Choose the kind first — Email, Telephone, Fax or Address — and the fields follow. An email address is checked as you type. A number takes its country from the dial code and is formatted as you type it, in that country's own form. Categories now belong to organizations only.

**Identifiers know their shape.** A social security number is nine digits that format as typed; a driver's licence is the state that issued it and the number; a bar number is its jurisdiction and the number; an account is who it is held with, the number, and the username and secret that go with it. The list names what is held and what it is of without revealing anything.

- **A meeting now holds three hundred people.** The room used to stop at twelve; it now takes the same
  number as the large plans of the tools firms compare it to, and the thirteenth person joining is no
  longer turned away.

**It stays usable at that size.** Your browser pulls video only for the tiles it is actually showing
and sound only for the people talking, and cameras send a smaller picture to a smaller tile, so a
full room does not cost you the bandwidth of three hundred cameras. Everyone else appears as a name
tile until they are on screen.

**You can see who is talking and who is muted**, on every tile, whether or not your browser is
pulling that person's sound — and joining a meeting already in progress shows you that immediately
rather than leaving the room blank until each person next speaks.

- **A large meeting shows you a page of the room at a time.** Sixteen tiles, with the page you are on
  and how many there are, and a way through the rest. Anybody you have pinned comes first, then
  whoever is sharing their screen, then the people who have been talking — so the first page is the
  part of the room the meeting is happening in, and somebody who starts talking twelve pages away
  comes to you rather than waiting to be found.

**Speaker view** puts whoever is talking large with the last few speakers in a strip beside them,
and **Pin** keeps somebody on your screen whatever else the room does. Both are yours alone: neither
changes what anybody else is looking at.

**Somebody with no picture is a name, and the tile says so.** A tile reading "Not shown" is a person
in the room whose camera is not being sent to you at this moment, which is the ordinary state of most
of a large room rather than a picture that failed to arrive. You still hear them, wherever they are
in the room.

**The list beside the room gains a search** once there are more than a couple of dozen people in it,
and every row carries the same marks as the tiles: who is speaking, who is muted, who is sharing.

- **You can sign out, and sign out of your other devices.**

**Sign out** in the menu behind your initials, at the top right, ends your session on the computer you are using and returns you to the sign-in screen. Nothing you were looking at stays behind in the browser for the next person at that machine. If a sign-out cannot be completed the screen tells you your session is still open rather than pretending you have left.

**Account → Active Sessions** is a new page listing every computer and phone signed in as you: what the device is, when it signed in, the address it signed in from, and when it expires. The one you are reading on is marked. Sign out of any of the others one at a time, or use **Sign out everywhere else** to clear them all in one go — which is what to do when you are not sure which of them is not you.

Two things the page is careful about. A device you sign out can take up to five minutes to be turned away, so the page says so and tells you to change your password as well if you think somebody else has your account. And it never shows a "last used" time, because what the record actually knows is when each session started — a time that looked like one and meant the other would have you clearing devices that were in use.

- **A setting on the calendar can repeat.** Recording a hearing or a firm meeting now asks whether it happens more than once. Choose how often — every day, week, month or year — and how many to skip between, so "every second Tuesday" and "every third month" are both one answer. A weekly rule falls on the day the setting starts unless you pick the days yourself, and can fall on several. A monthly rule asks which day it means: the same date every month, or the same weekday in the same position — the 15th, or the third Tuesday. Then say where it stops: never, after a number of occurrences, or on a date.

**The form reads the rule back to you in words before you save it** — "Repeats every second Tuesday, 12 times" — and the record and the printed sheet show the same sentence. A repeat is the one answer on that form whose mistake is invisible until somebody misses a setting, so it is stated rather than left to be inferred from four controls.

**It is one record, not one per date.** Correcting a weekly status conference is one correction, not fifty-two. A month that has no such date — the 31st in February — is skipped rather than moved to the 28th, because a firm that said the 31st did not mean the end of the month. And a weekly nine o'clock setting stays at nine o'clock when the clocks change.

**A repeat rule brought in from another calendar is shown as exactly that.** Where it is more elaborate than this form offers, the form says the rule was recorded elsewhere instead of showing you a simplified version that saving would make true. Turning Repeats on replaces it with yours.

- **A shipment can now say which matter it belongs to.** Choose the matter when you draft it, and the postage is recorded against that matter as a recoverable cost — which is what lets it be billed back.

Mail the firm sends on its own account needs no matter, and the picker says so rather than making you invent one.

- **Open any shipment from the list to see it in full** — where it is going, what it cost, which matter it belongs to, and its tracking history. It opens over the list, so closing it puts you back exactly where you were.

Ask the carrier where a parcel is with Check now, and the window tells you when it last asked rather than leaving you to guess how old the answer is. The label can be opened or printed from here, and a label you have not used yet can be voided.

Links to a shipment from anywhere else in the product land on it correctly.

- **Take files out of a zip without leaving the app.** Open a zip on a matter's Files page and you
  could already see what was inside it. Now you can get it out: select what you want and choose
  Extract, or extract the whole archive at once. Each file lands beside the zip it came from and is
  checked on the way in exactly like a file you upload.

Some members will not come out, and the screen says which and why rather than counting them: one
that is password-protected inside the archive, one packed in a way the application cannot open, one
whose contents do not match what the archive recorded for it. The rest still arrive.

- **Open a zip, a tar, a 7z or a rar and see what is inside it.** On a matter's Files page, opening an archive shows what it holds, folder by folder, without unpacking it or downloading it first. A very large archive opens as quickly as a small one, because only the part that records what is inside is ever read.

What the archive is called does not decide this — its actual contents do. One somebody sent you under the wrong name still opens, and a file named `.zip` that is not one is told to you as what it is.

Two cases will not show their contents, and each says which it is: a 7z whose list of files is itself password-protected, and one packed in a way the application does not read. Both can still be downloaded.

Taking files out is still zips only. The other three can be looked inside, and the screen says so plainly rather than acting as though they were empty.

- **Automatic filing can now be set up, watched, and stopped.** An auto-file rule puts a message on the
  right matter as it arrives rather than waiting for somebody to go and find the matter — most valuable
  on your firm's general capture address, where mail lands today with no matter at all. You can create a
  rule from a message you just filed, change whether it files outright or places the message for
  someone to confirm, pause it, put it back, or retire it for good.

**Two new answers you can ask for.** "Why is this message here?" returns the reasons behind an
automatic filing in plain sentences, weeks later, without anybody reconstructing them. And a
thirty-day summary tells you, per rule, how many messages it filed, how many it placed for
confirmation, how many of those somebody has since removed, and whether it has stopped itself — which
is the report to read **before** deciding whether to allow filing without a confirming click, so that
decision rests on what your rules have actually been doing rather than on a guess.

**Setting up a rule is a separate permission from filing mail.** Your firm can grant somebody the
ability to file email to a matter without also granting them the ability to configure the machine to
file email. A rule can only ever name a matter its creator can open, and it stops itself if they lose
that access.

**Rules stay cautious in the ways they always were.** A rule that follows a conversation can only be
created once your firm has actually filed a message from that conversation to the matter. Nothing
already in your archive is ever touched — creating, resuming or re-pointing a rule applies only to mail
that arrives afterwards. And a rule asking to file without confirmation is refused outright while your
firm has not enabled that, rather than being accepted and quietly doing something else.

The screens for all of this are still being built; what a rule does once it exists is described in
[Filing email to a matter](user/features/filing-email-to-a-matter.md).

- **Download the usage report in the format your next step wants.** Firm Usage's Download Report now
  offers plain text or a CSV that opens straight in Excel and other spreadsheets, and every file's
  name carries the date and time it was generated, down to the second, so two snapshots never blur
  together.
- **You can now record that a bill went out — and show it.**

Say how the client got it (posted, handed over, emailed, or submitted to their e-billing portal), who
received it, the date it reached them, and whether it arrived. Record it whenever you like: a bill
you posted last Tuesday carries last Tuesday's date, not today's.

Magna Carta does not send the bill for you. That is the point of recording it this way — most bills
go out by means you arrange yourself, and what matters is being able to show the client got it, not
which system carried it.

**Every attempt is its own permanent record.** A bill sent twice has two. A letter that came back
followed by a successful re-send reads as exactly that. Nothing you record is edited or deleted
afterwards, which is what makes it worth having when a client disputes a fee years later.

**And it shows up where it matters.** When you are about to take your fees out of a client's trust
money, the bill tells you whether there is any record of the client having received it — several
places expect that before fees come out of trust. It does not stop you. It tells you, and the
decision stays yours.

- **Each item in a packet now has a chain of custody you can read on its own.** Open a packet, go to **Contents**, and click an item: its history opens underneath it.

What you get is the item's own record and everything that happened to the packet holding it, because an original will inside a deed box went to the Reno safe when the box did. Entries about the whole packet say so, so you can always tell a move of the box from something that happened to this will alone. In the packet's own history it works the other way round: an entry about one item names which item it was, instead of leaving you to guess which of five instruments was withdrawn.

Nothing about how the record is kept has changed. It is the same append-only ledger, read at two scopes rather than copied into a second place, so a packet and an item can never come to disagree about the same object.

- **When an upload says storage did not answer, an administrator can now find out why by opening the version chip.** Its Database section checks each thing an upload depends on, from the server's side, puts right the settings it can, and shows the verdict on a File storage line, with an Upload readiness section beneath listing every check; the panel's copy control pastes the whole report into a message. The report reads top down: the first line that fails is the cause, and it says what to do. The upload dialog's failure message now points there.
- **Hold people at the door until you are ready for them.** Switch on "Hold arrivals in a lobby" when you start a meeting, or any time during one, and everybody who arrives waits until you let them in. Whoever is running the meeting — the host and any co-hosts — never waits.

Admit people one at a time or all at once, or turn somebody away. Somebody you turn away cannot come back into that meeting.

Turning the lobby off part-way through does not let in the people already waiting. They stay on your list until you decide about each of them, because switching a setting is not the same as saying yes to somebody.

- **Your firm can now tune when an auto-file rule stops itself.**

A rule that suddenly starts firing far more often than a person would — a mailing list, a bounce
loop, an autoresponder — goes back to staging and asks to be looked at. So does a rule whose recent
filings you keep undoing. Out of the box that is twenty-five filings in an hour, or three of the last
ten undone, and an administrator can move both to suit how much mail your firm handles.

What cannot be done is switching the protection off. The numbers move within a sensible range, and a
rule that runs away always stops.

- **Your firm can join the beta programme, and leave it, from Settings · Beta Access.** Beta builds carry work that has passed review and has not yet been released — they run against your real matters, real client money and real documents, not a copy.

Joining asks you to confirm that, and records who did it in the firm's audit log. Leaving takes one switch and asks nothing: what a beta build already recorded stays recorded.

- Billing and Costs are places you can go. **Billing** in the sidebar is every bill the firm has raised, for every client, with what is still owed and how far past due it is over the table. **Costs** is what the firm advanced across every matter for the days you choose — what is still waiting on a bill, and what the firm decided to absorb.

Neither question could be asked before. A matter's own sections answer for one file, and no amount of visiting matters one at a time adds up to what the firm is owed or what it laid out last month.

**A matter's Billing section now shows the matter's bills, not the client's.** It listed every bill the client had ever been given and then worked out this matter's share of each one, which stated the client's account under the matter's heading. It reads its own bills now: the ones that charge this matter, drafts included, each showing this matter's share. The whole document's total is still there as a column you can turn on, named "Total (all matters)" so the two are never confused.

**A billed cost or time entry names the bill that billed it.** Right-click one and choose "Open The Bill" to see what the client was actually told. An open bill is in the address too, so you can send somebody the bill rather than a register and instructions. A billed cost offers the same way through from its own record and from the details panel beside the list, and its printed sheet carries the bill's reference.

**A cost that was sent back says why.** A reviewer who returns a cost writes a reason; nothing
showed it, so a returned cost looked exactly like a draft you had never submitted and you were left
to guess what was wrong with it. The reason is now the first thing on the cost's Details tab, sits
beside the list, and clears itself the moment you send the cost back for review. Note that cost
review itself is not switched on for any firm yet — the setting that turns it on is not served —
so this is the reading half arriving ahead of the workflow, not a flow you can run today.

**A cost says who recorded it and when.** Entered By and Date Entered carry values on both cost screens now; they start hidden, because they answer a question about the record rather than about the money, and a reader who wants them turns them on. Date Entered is when the cost was written down, which is not the day the money went out — a disbursement captured three weeks late is a different record from one captured the day it was paid. Entered By is who to ask when a figure looks wrong, never a lock: a cost belongs to the matter it was advanced for, not to whoever typed it. A cost recorded by somebody who has since left the firm says so rather than showing an internal identifier.

**Each matter money section knows its firm-wide twin.** The row across the top of Time, Costs and Billing ends with the way out to the same money at the firm's scale.

Applying trust funds, writing off a balance and recording a credit note stay a matter's acts — they move one matter's money. The firm's register shows them and says where they live rather than hiding them.

- **You can now correct a bill that has already gone out — without the bill changing.**

Issue a **credit note** against it and say why, in your own words. What you credit comes off what
the client still owes; if they have already paid, the part the bill can no longer absorb is recorded
as money the firm owes them back, and that credit stays visible until you give it back. You can set
it against any later bill for the same client, refund it, or return it to their trust account —
whichever your agreement calls for. A matter will not close while a credit is still open.

**Write off** a balance you have decided not to chase, with the reason. It is kept separate from a
credit note on your books, because giving up on money you were owed is a different fact from
conceding you should not have charged it.

**Undo** a payment or credit recorded against the wrong bill or the wrong matter. The original stays
readable and the reversal is a new record linked to it.

**And if a settlement collapses after you have billed your contingency share**, ask the matter for
its contingency position. It compares what you have actually billed against what the surviving
recovery now entitles you to, reports the difference, and names each bill that carries the fee and
what it still owes — so you can see, before you raise anything, whether a correction would reduce a
debt or leave you owing money back. Nothing is issued for you: what a client is owed when a case
falls apart is your call.

The bill itself never changes. It keeps its number, its lines, and its wording forever, and every
correction stands beside it on the record.

- **See inside a zip without downloading it, and a file history that tells the whole story.** Click a
  zip file on a matter and you can now browse what is inside it — folders, file names, sizes, and
  dates — without downloading or unpacking anything. Very large archives list just as fast as small
  ones, and a listing cut short by your firm's archive limits says so instead of pretending it is
  complete. A zip in the Deleted Files view can be browsed the same way, so you can check what is in
  it before deciding to restore. The matter's file History now also says what actually changed: a move
  shows the folder it left and the folder it landed in (by their current names), a deletion shows
  where the file was, a restore shows where it returned to, and a document-type change shows the type
  by name. Older history entries recorded before this change simply leave those blanks empty rather
  than guessing.
- **Magna Carta now notices when your records change under a matter you have already screened, and
  re-runs the check itself.**

Six kinds of change set one off: a party added to a matter; two directory records merged into one; a
name added or changed; a relationship recorded; a tax or social security number entered; and somebody
joining the firm. A scheduled sweep re-screens your open matters weekly on top of that, because a list
of triggers is a list, and any list can turn out to be incomplete. Adding a person to your directory
on its own does **not** set one off — otherwise importing two thousand contacts would re-screen your
entire caseload for no possible new result.

The part that matters most is not the speed. **A matter says a re-check is owed from the moment the
change is recorded**, naming what changed and when — not from whenever the re-check runs. If your
firm's re-screening ever falls behind, the matters waiting say so out loud instead of looking up to
date. A backlog you can see is a different thing from a stale answer that looks fresh.

Several changes to one matter become one search that lists all of them, rather than several searches
or two of three quietly dropped. An automatic check is never credited to a person: it records that it
ran by itself and what set it off.

You are told when an automatic check turns something up — a result at one of the two strongest
evidence levels, or the first result ever on a matter that had none. A check you ran yourself does not
notify you; you are looking at it. The notification says how many results surfaced and how many are
strong, and takes you to the matter. It carries **no names at all**: a notification sits in a feed and
an inbox long after it was sent, and the detail belongs behind the link where your permission to see it
is checked at the moment you look.

And nothing about this decides anything for you. An automatic re-check runs a search and records what
it found. It cannot mark a result reviewed, cleared, or waived — that stays a person's act with that
person's name on it, and the software is built so that it cannot do otherwise.

New guide: [Automatic conflicts re-checks](user/features/automatic-conflicts-rechecks.md).

- **A conflicts check now tells you what it searched, what it could not search, and what nobody has
  answered yet — and it will never tell you a matter is safe to accept.**

Every matter has a conflicts position you can read at any time. It answers six questions separately,
because collapsing them into one answer is what loses the information: when the matter was last
checked and under what settings; whether your firm's policy has been widened since, so that the last
check no longer covers everything you now require; which sources could not be searched at all, named,
with the reason; how many results are still waiting for a person to look at them, grouped by strength
of evidence; which results have been decided and by whom; and whether the matter has ever been checked
at all — which is shown as its own answer, never as the same thing as a check that turned up nothing.

The position is worked out fresh every time you look, so widening what a check must cover shows up on
every affected matter straight away, without re-running anything.

A check that turns up nothing now says so in plain words, ending with the sentence **"Nothing
surfaced."** That sentence is about the search. Magna Carta does not show a tick, a score, or a
one-word verdict on whether a matter is safe to take on, and it will not: a search can only look at
what has been recorded, and several things a conflicts search would ideally examine have nothing
behind them yet — the report names each one every time. Describing the procedure is what your firm can
stand behind if it is ever asked how a matter was screened. A verdict the software produced is not.
Deciding remains a lawyer's act, and the record says whose.

New guide: [Conflicts reports](user/features/conflicts-reports.md).

- **Discovery has screens.** A matter's new **Discovery** section lists the review sets on that case and starts one; the **Discovery** row in the sidebar lists every review set you can open across every case; and opening one gives you its documents and its loads.

What you can do end to end: create a review set, name the Custodians of Record whose material it holds, declare a load — saying what is coming before it arrives, which is what lets the manifest state a finding rather than a claim — put the matter's own files into it, and watch every document reach one of exactly two endings. Nothing is copied: each document points at the version you picked, so your storage does not double and a later version of that file does not silently change what is under review.

**The two records a load produces can now be handed over.** The manifest says what arrived; the exception report names every document that could not be read, with the reason for each. Both download from the load, in a printable form for attaching to a letter and a machine-readable one. Taking a copy is recorded in your firm's audit log — which load, which record, which form, and never a word of the contents.

The documents screen narrows from one control: by Custodian of Record, by load, by whether a document was read, by the named reason it was not, and by family. Whatever you narrow to is in the address bar, so a narrowed list is a link you can send to somebody else on the review set. Searching by keyword, narrowing by date, and narrowing by coding are shown in the same control and unavailable, each saying what it is waiting for.

**Opening a document opens the reviewer**, walking exactly the documents you narrowed to, in that order — brackets move along it without your hands leaving the keyboard. You get the text the engine read out of the document, beside what the document is: its dates, its size, the engine that read it, the hashes recorded for it, what arrived with it in the same family, and every other copy of it the review set holds with the Custodian of Record who held each. A document that could not be read still opens, and leads with the named reason rather than a blank pane. Coding it, and seeing the original rather than its text, are named there and not built yet.

A review set you have not been put on does not appear at all, on any of these screens. That is deliberate: material another party produced is often under a protective order that not everybody on a case is cleared for, so working the matter is not enough, and a review set that showed itself while refusing you would already have said something.

- **A document you build from a template can now be built as a PDF.** Choose "PDF — ready to sign" in
  the Build-a-document dialog and the finished document is filed as a PDF rather than a Word document,
  which is the form it has to be in before it can be signed. It takes a little longer, because the
  document is converted before it is filed.

If the conversion cannot be done, the build fails and says so. You will not be handed a Word document
in place of the PDF you asked for.

- **Documents is now a place you can go.** It is your firm's template library: every Word template and fillable form the firm has registered, who it is for, and whether it is ready to use. Register a template there from a Word document or a PDF form, and it tells you what it found in the file before anyone builds from it.

**Add a template to several matters in one go.** Choose the template, pick the matters, choose Word or PDF, and a document is built onto each matter, with a row per matter saying whether it landed, whether it has blanks you should look at, and where to open it.

- **Files and folders move by being dragged.** Pick up a row in the list, a tile in the icon view, or a folder in the left sidebar, and put it down on a folder in the sidebar, a folder in the list, or a crumb in the path above the list — which is how something comes back out of a folder, since every folder above where you are standing is already on that strip. Dropping on the home icon moves it to the top of the matter.

**Select several first and dragging any one of them carries the lot**, and what you are holding says how many.

**What cannot happen is refused before you let go.** The cursor says no over a folder that already holds the thing, over a folder being dragged into itself or into something inside it, and over anything that is not a folder. If only some of what you are holding can go where you are pointing, those are the ones that move.

**A move you made by dragging can be taken back** with the undo arrows at the bottom of the screen, exactly like one made from the menu. Dragging is the fast way and not the only way: Cut and Paste still make the same move from the right-click menu and from the keyboard. Dropping files in from your computer is a different thing and still starts an upload.

- **Every document you edit in the browser now records who changed what, and your firm decides
  whether it does.** Until now a document recorded changes only if somebody turned recording on, so
  the record of who wrote which words began whenever somebody remembered to. Now every document opened
  in the editor records from the first edit, and the control for turning that off is not offered. The
  marks stay hidden, so the page reads and types the way it always did; the editor's Review tab shows
  them to anybody who asks.

It is your firm's setting, on for every firm, under **Settings › Documents › Editing**, because a
firm that files documents with the other side may decide otherwise. Switching it off asks once before
it lands and is written to the firm's audit log. For now a downloaded copy carries the marks;
producing every copy that leaves the firm with them accepted is coming.

- Spreadsheets and presentations open in the browser editor. A new settings page, Opening Files, lists what every kind of file does when you open it.
- Every save in the editor now appears in the document's history, with the autosaves folded away until you want them, and each version shows everyone who was editing at the time.
- **Deleted files can be seen, restored, and accounted for.** The matter's Deleted Files view now has
  a real list behind it — what was deleted, when, and by whom — and Restore brings a file back where
  it was (or to a folder you choose; a file whose folder is gone lands safely at the matter root).
  History shows the matter's whole file trail — uploads, renames, moves, deletions, restores, and
  downloads — with each entry under the file's current name. And zip files uploaded from Windows are
  no longer refused.
- **Follow a suspicious link through every step it takes.** The Safe Website Viewer has a Live mode.
  Where Static looks at each link on its own, Live keeps one isolated browser for you while you look
  around, so you can follow a link past a "confirm you are human" page to whatever it was hiding. You
  still only ever see pictures and text — nothing from the site runs on your computer. Live closes
  itself after a few quiet minutes, and tells you when a page had to start fresh.
- **Settings · Billing now sets how your firm measures the time it bills.** Choose the increment a captured duration rounds to — a tenth of an hour, a quarter, whatever your firm bills at — and whether time between increments rounds to the nearest, always up, or always down.

Time already captured keeps the rounding it was recorded under. The change applies to what is captured after it.

A matter, a client or a timekeeper can carry its own increment, and that one wins over the firm's — so setting the firm's rule here does not disturb a file somebody deliberately set differently.

- **You can now ask Magnus a question, in two places.**

**Magnus in the sidebar** is yours: every conversation you have had, newest first, with the matter
each one is filed on named underneath. A conversation started there belongs to no matter.

**Magnus on a matter** — the Magnus tab — keeps the conversation on that matter's file. It shows the
conversations belonging to that matter and nothing else, and anything you start there is filed on it
without your having to say so. A conversation started in a matter appears in your sidebar list too:
one conversation, read from two directions.

**Magnus sees only what you type.** Not your files, not your calendar, not your directory, and not
the matter you are standing in. Filing a conversation on a matter says where the transcript is kept;
it does not hand Magnus the matter. If you want Magnus to work with something, put it in your
message.

**Magnus only answers.** It cannot open a matter, book time, file a document, send anything, or
change any record.

**Magnus can be wrong.** Its answers are not legal advice and nobody has checked them. Verify
whatever you rely on.

The first time you open it you are shown a short disclosure and asked to accept it — what leaves the
platform, what Magnus can see and do, that the transcript is kept as a firm record your colleagues
with permission can read and your clients never can, and that it can be wrong. You accept it once,
and again only if what Magnus can see or do changes.

You can name a conversation, and delete one. Deleting removes it and everything in it, which is the
only way to remove what was typed.

Magnus is off until your firm turns it on, and that takes two separate decisions: your firm must
allow its information to reach an AI provider at all, and it must enable Magnus specifically. If
either is missing, the page says which one and who can change it.

Full guide: [Asking Magnus](user/features/asking-magnus.md).

- **Magnus is easier to keep in order, and can read the files you hand it.** The list of your
  conversations sorts by date, by name, or by the matter each is kept on. Rename a conversation by
  clicking its name. Keep a conversation on a matter after the fact, or take it off one: the
  confirmation says who can read it afterwards. Attach a matter's files to a conversation and Magnus
  reads their text with your next question; beside each file the conversation says whether Magnus saw
  it whole, saw part of it, or could not read it. Because Magnus can now see more than what you type,
  you will be asked to accept the updated disclosure once. Firm administrators can now choose which
  verified model answers, on the AI settings page, or leave the firm following the platform's current
  model.
- Matter plans — your firm's own list of what a kind of matter takes.

Write one under **Settings → Matter Plans**: the calls, the letters, the filings a kind of matter
needs. When a matter of that kind is opened, its Tasks page offers the plan.

**A plan offers; it never imposes.** Press **Review** and you see exactly what it would add — each
step, the date it worked out, and who it would go to. Nothing exists at that point. Untick what this
matter does not need, fix anything wrong, and press Add. Closing the review adds nothing, which is
all declining is.

Two things a plan cannot know, and the review is where you catch them. **Dates are counted in plain
days** — nothing skips weekends and nothing knows about court holidays — so a step set to 14 days can
land on a Sunday, and the review flags it and lets you move it. And **a step names a role rather than
a person**, matched against that matter's own team, so where nobody holds the role the step arrives
unassigned and tells you which role could not be filled.

Editing a plan changes what it offers from now on and **never touches tasks already on a matter** —
those were reviewed and accepted as they stood. Plans are never deleted, only taken out of
circulation, because every task a plan produced records the plan and the step it came from.

**No plans come with Magna Carta, and that is on purpose.** A plan is a statement about how your firm
practises in your jurisdiction. One written by us, with a step missing or out of order, would look
authoritative precisely because it shipped with the software.

A plan cannot yet apply itself without review, and its dates can only count from the day the matter
opened.

- **Meet by video without a second subscription.** Open a calendar event and press **Start meeting**; everyone else on the event sees **Join meeting** in the same place. You see and hear each other, anyone can share a screen, and the controls are the ones you would expect: microphone, camera, share screen, leave. Whoever started it can end it for the room.

**The meeting is on the record.** When it ends, the event shows who was in the room and when each person joined and left — so the case file remembers the conference the way it remembers a document or a filed email, rather than leaving it in another company's account. Nothing said in the meeting is captured: there is no recording, no transcript and no chat log.

**Communications has its own place in the sidebar.** Messaging and Meetings now sit together under **Communications**, and the Meetings page shows every meeting that is live now, coming up, or recently ended, so you can get back into a room without finding the event first.

**What this first release does not do yet.** Only people at your firm can join — there is no way to invite a client or another party in, and no way to dial in by telephone. A meeting holds twelve people. Guide: [Meetings](../docs/user/features/meetings.md).

- **Choose what you hear about.** Settings · Notifications lists every kind of thing the platform can tell you — deadlines, calendar, tasks, trust, billing, documents, custody, email, conflicts, jobs, security, system — with one switch for your in-app feed and one choice for email, category by category. Email arrives as a daily or weekly summary rather than a message per event.

A category you have switched off tells you what it has held back, and since when, so turning something off stays a decision you can see the effect of rather than a silence you have to notice.

Two categories, trust and security, always reach you in app. Your firm may also insist on others; those say so and cannot be switched off. Nobody can force email on you — whatever your firm suggests, your own choice wins.

**Firms set their side under Settings · Notification Policy:** which categories everybody hears whatever they choose, how long notifications stay in the feed, and what hour the summary mail is sent.

- **Offices have a screen.** Under Settings › Firm › Offices the firm's places of business are a table: name, standing, jurisdiction, time zone, numbering code, street address, telephone and how many members work there, with the email, the mailing address, the logo and the firm default a column-menu press away. A row opens the office's record, where it is entered, corrected, staffed, given its letterhead logo, made the firm's default or closed.

**An office has an email, and its addresses take the country's shape.** The street address and the mailing address are entered through the same country-shaped form every address in the product uses, each with its own telephone grouped the way that country writes numbers.

**The firm has its own marks.** Firm Profile holds a primary mark and any additional images beside it. Every office's letterhead prints the primary mark until that office is given a logo of its own, so a single-office firm sets its identity once.

**Firm Profile is the identity page.** The name, the marks, and the firm's offices with a link to each.

- **Take files out of a tar and a 7z, not just a zip.** On a matter's Files page, open an archive and extract what you need — the same selection, the same checks on the way in, the same version history as a file you upload yourself.

A rar can be looked inside but not unpacked here. The Extract control says so up front instead of refusing after you click it; download the rar to open it.

When a member will not come out, the screen names which one and why: it is password-protected inside the archive (a 7z can lock its files one at a time, so some members of one archive may come out while others do not), it is packed in a way the application cannot open, it is a shortcut or a device entry rather than a file, or its contents do not match what the archive recorded for it. The rest still arrive.

- **A matter can now be searched from one box, and it starts with the screen you are already on.**

Remembering "there was something about the easement" used to mean guessing which tab it was filed under and searching that tab — if it had a search box, which most did not.

The search sits at the top right of every matter screen. It opens scoped to the section you are standing on, because that is usually the question, and one click widens it to the whole matter. It never goes wider than that: searching the whole application is what the box in the top bar is for, and a search that sometimes answered with a settings page when you asked about a case would be worth trusting for neither job.

Eight parts of a matter answer today — files and folders by name, time narratives, costs, bills, parties, calendar entries, notes and the originals held in custody — and every result says which section it came from and what it matched on, so a hit is never a guess. The six sections that cannot answer yet are still listed, each greyed out with the line saying what it is waiting for; a section that simply vanished would teach you nothing. Results are grouped by section rather than shuffled into one ranked list, because there is no honest way to rank a file name against a note.

A section you do not have access to says so rather than coming back empty. That distinction matters more than it looks: a search that answered "nothing found" for a section you cannot see would tell you the matter holds nothing when it may hold a great deal.

Next to the scope, **Include deleted** is off by default and appears only where a searched section has a deleted set to offer. A deleted file joins the results marked as deleted, never looking live.

Top results appear under the field; **Open full results** gives the whole answer its own page, and the search lives in the address — so a reload keeps it, and a colleague can be handed the link.

Assets are matched on their description alone: an asset's account and policy numbers are sealed, and searching them would let somebody confirm a full number by typing it.

Two things it deliberately will not do. It does not look inside your files yet, only at their names, and it says so rather than implying otherwise. And it can never reach material another party produced to you in discovery: that lives in its own sealed index, which is exactly why an ordinary matter search cannot name it.

- **A matter's parties can be added from the Parties page.** Pick a person or an organization from
  the Directory, choose the role, and record the capacity if there is one. One person can hold more
  than one role on the same matter; the page says which roles they already hold and refuses only the
  exact repeat. Removing a party asks first, and says in as many words that the person stays in the
  Directory with everything recorded about them.

**The Directory has moved to `/directory`**, matching what the navigation has always called it.

- **You can re-check a matter without filling in a form.**

Where a matter's conflicts standing is shown, "Re-check now" runs a fresh check against the matter's
current parties — including anyone added since the last one — to the firm's own standard. There is
nothing to configure, because there is nothing you should have to decide: the firm sets how
thoroughly checks are run, and that setting is what runs.

The check is recorded as yours, with your name on it, and it takes you straight to what it found.

**The firm's own standard is now shown where you run a check.** The panel used to say an empty field
takes the firm's setting without being able to tell you what that setting was. It now names the
sources every check must search, the strictness it must reach, and the depth and limits it runs to.

- **Reports has a screen.** Open Reports from the sidebar to see every report the platform offers,
  grouped by family. The trust compliance report runs today: choose a trust account, a period (this
  or last month, quarter or year, or any range), and whether you want everything known now or the
  figures as they stood at the end of a chosen day, and the report appears below with its cover, each
  reconciliation, every client and matter ledger, the receipts and disbursements journal, the holds
  and exceptions, and its provenance. Export it in any format from the menu at the top, and send
  somebody the address to show them the same report. A chosen day ends at midnight in the time zone
  of the office that holds the account. What the trust compliance report lists, such as ledgers at
  zero and who authorized each payment, is now a firm setting under Settings, Practice, Reports, so
  every copy of the report reads the same. The financial, productivity and operational reports are
  listed and marked Soon, each saying what it waits on.
- **Rooms.** Under Settings › Practice › Rooms and Resources, name what the firm can book: conference rooms, pool cars, equipment, each with an office and a seat count. Open any event and press **Book a Room** to book one for that event's window; the event's **Rooms** tab lists what it has booked and releases any of it. If a resource is already taken the booking still lands and says so, because a room being taken must never be why a hearing cannot be recorded. **Rooms** on the calendar shows one resource's week with every double-booking marked; press an entry and the event behind it opens.
- **See what a suspicious link leads to, without opening it.** The Safe Website Viewer in Tools now
  has its page: paste a link you do not trust and the page loads on an isolated remote computer, never
  in your browser. You get back a screenshot, the page title and text, every redirect the link passed
  through (with a plain callout when it lands on a different site than it started on), the links the
  page points at, and the server's response details. Everything you see is a picture and text, so
  nothing from the suspect site can run on your device. Nothing is saved. The WHOIS Lookup page also
  reads better: its search box sits at the left edge and its explanatory text stays put while you
  search.
- Tasks — work with somebody's name on it, on a matter or on none.

Every matter now has a **Tasks** section, and **My Work** in the sidebar gathers every task you can
reach in one list: across the matters you can see, plus your own work that belongs to no client file.
Renewing the malpractice policy and interviewing a candidate are real firm work, and they now have
somewhere to live that is not a spreadsheet. A task with no matter is private to you and whoever you
assign it to.

A task carries what to do, whose it is, a due date and time if there is one, and one of four
priorities. Assign it to a colleague and they are told. You cannot assign a task on a matter to
somebody who cannot open that matter — that would be a gap in their list nothing explains — so it is
refused when you try rather than appearing and then not working.

**Cancelling and deleting are different, and both are offered.** Cancelling is for work the firm
decided not to do: it asks why, and that answer stays on the task, so six months later somebody can
see what was proposed and why it did not happen. Deleting is for a task that should not exist — a
typo, a duplicate — and it is gone. Finishing a task records who did it and when, and reopening one
is always possible.

A task can say it is waiting on another one, which sorts it below and marks it — and stops you doing
nothing. Real work has exceptions constantly, and a checklist that argues with you is a checklist
people stop using.

**Overdue is worked out fresh whenever you look**, in the task's own time zone, so it is never based
on a stale calculation. A task due Friday is not treated as late on Friday morning.

Tasks are deliberately kept apart from deadlines. A deadline is what a court or a rule requires of
the firm and lives on the matter's Calendar, where missing one is serious; if that list filled up
with reminders, people would stop reading it.

Closing a matter tells you how many of its tasks are still open and changes none of them. They are
not cancelled or completed — they simply stop cluttering the day-to-day list, and reopening the
matter brings them straight back.

Matter plans — a template that lays out a standard set of tasks when a matter of a given kind is
opened — are designed and not built yet, and neither are board views, recurring tasks, or reminders
for tasks that are coming due.

- **Your calendars, in folders, each in its own colour.** The calendar now lists every calendar your firm has down the left: the firm's own matters and deadlines, its events, each attorney and each of your support staff under the role they hold, every conference room, and the date calendars. Tick one to add it to the grid, or tick a folder to add everyone in it. Give any of them a colour — press the dot beside its name — so you can tell one person's day from another's at a glance.

**A day view, with a column per calendar.** For a day when several people are in several places, press **Day**: the hours run down the side and each calendar you have turned on gets its own column, so two things at ten o'clock stand side by side and a free afternoon is visible as a gap.

**Start a record by double-clicking.** Double-click an empty day on the month, or an empty hour on the day, and the event form opens on it.

**The forms ask better questions.** **Location** offers your own offices and conference rooms and still takes anything you type, for a courthouse or opposing counsel's. A **Conference link** field holds the Zoom or Teams link for a setting held on a call. Start and end are proper time fields, with the time zone beside each as a shortcode — PST, EDT — rather than a long name. And while you are choosing a time, **that day's calendar stands beside the form**, so you can see who is already busy.

**An event no longer needs a matter.** Leave the matter blank and the form records it as a firm event instead.

- **Two more things on the calendar.** Under Settings › Practice › Event Types, keep the words an event is classified under: recategorize or retire the ones that ship, add your own. On any event, press **Relate** to link it to another setting that belongs with it, and the Links tab lists them by title.
- **The calendar reaches Home and the matter overview, and it can show more.** Home now opens with **Today**: what is on your own calendar today and tomorrow. A matter's Overview shows **Coming up**, its next thirty days. Both open the same window an entry opens everywhere. On the firm calendar, pick a colleague to read their calendar beside your own and everyone's; press **Custody dates** to add the register's due-back and review dates; and on the agenda, press **Hide settled** to see only what is still coming.
- **The calendar has a screen.** Calendar is now in the sidebar. It opens on the whole firm's month: every hearing, deposition, filing and deadline on every matter you can see, and the firm's own meetings, closures and holidays beside them. One press narrows it to what is on your own calendar, and the address remembers which you chose, so a link hands a colleague the same view.

On the firm-wide grid an entry reads as what it is and which matter it is on, "Hearing, 2026-0042", and never as its title: a calendar that spans every case does not broadcast what each one is about. Press an entry and it opens with its title, its people, its place and the zone its time is read in. Deadlines show their titles and say when they are past due, worked out in their own time zone each time you look.

Month, week and agenda are three views of the same calendar. A day with more than the grid can show says how many more and opens the agenda on that day. The week is seven days with each day's entries listed, because most of what a firm records is a date rather than an hour.

Recording no longer waits on anything. From the calendar's Record menu, or from a matter's own Calendar section, record an event on a matter, a deadline on a matter, or a firm event. A person at an event is picked from the firm, from the directory, or typed once for somebody who is neither, such as a judge or a court reporter. A deadline asks for the authority it comes from in your own words and never calculates a date.

Open an entry to correct it in place, cancel a setting with a reason, continue a hearing the court has moved (both settings stay on the record, linked, and the window lists the deadlines that hung off the old one without moving any), satisfy a deadline, vacate one with the reason, or supersede it with a new one.

The matter's Calendar section keeps the two tables it had as its List view and adds Month and Agenda beside them.

- **The conflicts screen now lists the checks your firm has run.**

It used to say the platform knew the question and could not answer it. Each line shows when the check
ran, what started it, who asked for it where a person did, and how many candidates it surfaced —
and opens the check itself.

A check that ran automatically says so rather than showing a blank where a name would be: nobody
asked for it, and that is a different fact from the record not saying who did.

Where a check searched more widely than it was asked to — because the firm's own floor raised it —
the line says so, which is what explains a result set larger than the person who ran it expected.

- **Opening a matter starts with choosing the client from the Directory.** Type three characters of
  the name, pick the person or organization, and the matter is linked to their record from the moment
  it exists, whether it opens outright or is recorded as a consultation. Someone not in the Directory
  yet is added there first, which is what keeps one client from ending up in the book twice. Open
  Client Record takes you to them, and Run Conflict Check searches the firm's record for them before
  the matter is created, telling you how many hits it found and where to read the report. The
  matter's Overview shows the client as a link to their record.
- **Firm Usage now counts what Custodian holds, office by office.** The By Location table shows how
  many original items the firm keeps in safekeeping at each office, with anything stored at an
  external site, such as a bank vault, on its own Held Offsite row. An item that is checked out
  counts nowhere, because the shelf really is empty. The downloaded report carries the same figures.
- **You can now put things into the safe custody register from the screen.** Until now the register could be read and not written: there was no way to log a packet, describe what was inside one, or file a scan against it.

**New** logs a packet: what the firm is holding, whom it is held for, and which container it goes into, plus who handed it over and when, notes, and a number carried in from a paper register where the label already has one. Inside a packet, **Describe An Item** records one thing it contains, with its type, its own date, and the irreplaceable-original flag your firm's item-type list pre-answers. **File A Copy** links a document the firm already holds to the packet, or to one item in it, as a scan, photograph, receipt, appraisal or correspondence. Logging from a matter's Custodian section fills in the matter and asks you the rest, because property belongs to a person rather than to a file.

The register screen is now one table. The By Owner, Holds and Due tabs are gone: two of the three were the register narrowed, and a firm not yet using holds or due-back dates was being shown empty screens to discover that. Narrowing by status happens in the Status column, and the storage tree still narrows the register to a whole branch.

A packet somebody has taken out now reads **On loan** rather than **Out**, so it cannot be mistaken for one that has been **Released**. The two are opposites and the labels were not saying so: a loan is still the firm's and has a due-back date against it, where a release has ended the firm's custody for good and is the one step that cannot be undone. Hovering either now says which it is.

An empty register no longer runs off the right-hand edge of the screen.

- **Relationships can be recorded on a Directory record.** Choose the other record and the kind of
  relationship, with an optional role and note. An organization's record now has a People page listing
  its officers, directors, partners, employees, members, shareholders and points of contact, and a
  person's record has an Organizations page listing the organizations they belong to. A category the
  firm has not named yet is created and assigned in one step.
- **The matters list now shows who each matter belongs to.** A new **Responsible Attorney** column names the colleague the matter is filed under, and it can be sorted, filtered and hidden like any other column. A colleague who has left the firm is still named on the matters they carried, because that is who held them. Where the person on a matter is not on your firm's member list, the cell is left blank rather than showing an internal reference that means nothing.

The same firm member list now sits behind the people-pickers elsewhere in the app: the colleagues offered when you report an issue, or ask an administrator to change a setting, are your firm's real colleagues with the role each one holds shown beside their name — not a sample list. Every member of the firm can read it, whatever else their account is allowed to do; it shows who works here, never anyone's contact details or what they are permitted to change.

- **Your downloads are now at the top of the screen.** A download button sits beside the timer in the
  top bar: it marks itself when something new arrives, and clicking it shows what the platform has
  recently made for you, with a link to the full list at the bottom. Taking one from the panel gives
  you it back in the format you took it as; the full page is where you can choose a different one.
- **Help › About inside the editor now shows which Magna Carta build is serving the document**, beneath the editor's own versions: the build, when it was committed and when it was built. That is what to quote when reporting a problem from inside a document.
- **Reports now download as Word and PDF.** The Download Report menu on Firm Usage gains **Word
  (.docx)** and **PDF (.pdf)** alongside Excel, CSV, and plain text — a clean, printable document
  with the same figures the page shows: a title, the generation date and time, and each section as a
  table whose header row repeats across pages. If the document engine is briefly unavailable the page
  tells you plainly and you can simply try again.
- The Files section of a matter is now a proper file manager.

Folders run down the left, the files in the folder you are looking at fill the middle, and whatever you select is described on the right. Drag the edge between any two of those to make one wider.

Choose which columns you want and click any of them to sort. Select several files at once. Right-click a file to open it, download it, rename it or delete it — renaming leaves the file extension alone, and deleting moves the file out of the list without destroying it.

- **You can see what your firm has posted, and buy postage yourself.** Shipping & Postage lists every shipment — who it went to, where it is, what it cost, and which matter it belongs to — and you can sort, filter and choose the columns as on any other list in the product.

New Shipment walks through it: who it is going to, what is being sent, whether it needs certified mail, a return receipt or a signature, then the live carrier rates to choose from. Postage and the platform's service fee are always shown as separate lines before you buy, because postage is what gets billed on to a client.

An administrator connects the firm's carrier account under Settings. The key is stored encrypted and never shown again — if it is lost, issue a new one with the carrier and replace it.

- **See what your firm holds and what it uses.** Firm Usage, under Tools, shows your storage by
  class, matters by type, files and their versions (including what deletion still holds), a
  per-location view you can sort, your Directory counts, and your AI usage — every figure computed
  fresh the moment you open the page. Owner and Admin seats only.
- **Your firm can now decide what every conflicts check has to cover.**

Under **Settings, Conflicts**, an owner or administrator sets the minimum every check searches,
whoever runs it. Somebody running a check can search wider; a narrower request is raised back up to
the floor before it runs, and the check records that this happened. Nobody can search below what your
firm requires. Until now these settings were real but unreachable — changing them meant editing your
firm's stored configuration directly.

You choose what a check searches, which band it must reach, which of a person's names the narrower
band compares — current, former, maiden, alias, and two more you can add — how far a check follows
each kind of relationship, and the two limits on how much any one check may do.

Two controls are shown but cannot be switched off, each saying why. Your party register is always
searched, because conflicts apply across your whole firm. And a person's current name is always
compared, because a check that skipped the name someone goes by today would not be a conflicts check.

Three things are worth knowing before you change it. **Changing the floor re-runs nothing** — no check
already on your record is altered or repeated; instead, any matter whose last check no longer covers
what you now require says so on its own Conflicts tab, worked out fresh each time it is read.
**Narrowing the floor reduces what your firm will look at from then on**, and no individual check
records that somebody chose that, which is why the change is kept in your firm's audit trail and
limited to owners and administrators. And **what you save is what you are shown**: if you ask for
something that cannot be stored as given, it is adjusted on save and the screen tells you exactly what
was adjusted.

Updated guide: [Conflicts reports](user/features/conflicts-reports.md).

- **Your firm sets its own file-scanning policy.** Settings · File Safety & Scanning now works: choose how much of the scanner's rule set an upload is checked against, how confident a suspicious match has to be before it counts, and what your firm can do with a file the scanner flags — hold it, ask before opening it, or allow it with a mark. A flagged file is never deleted, whichever you choose.

Loosening what a flagged file may do asks you to confirm, because that is your firm deciding a file its own scanner distrusts may be opened.

Changes take effect on the next upload and on the next attempt to open a flagged file already on file — nothing needs re-scanning.

- **Your firm chooses the day its week begins on.** Every calendar in the firm, the firm's own and every matter's, now begins its week on the same day: Sunday unless an administrator changes it to Monday under Settings › Calendar. It is the firm's setting rather than each member's, so "next week" means the same seven days to everybody. Changing it moves the columns, never the dates, and the change is recorded.
- The version chip at the top right can now tell you whether Magna Carta can reach your firm's own
  records. Open it and look under **Database**: it shows whether your firm's database answered and how
  quickly, whether it has caught up with the version you are running, and — the row that matters when
  a screen has just refused you — whether your account has been written into the firm's records yet,
  which roles you hold, and how much those roles permit.

That last row exists because of one specific frustration. On a firm created a few minutes ago, every
screen can refuse you with a message about permissions when the real answer is that your membership
is still being written and will arrive on its own. The panel now says which of those it is, with a
line telling you whether the record is still on its way or has failed and needs releasing. **Copy
diagnosis** puts the whole reading on your clipboard for a support request.

The overlay's **Deployment** and **Database** sections each fold away behind the caret beside their
heading, and it remembers how you left them. A folded heading still shows anything wrong underneath
it — amber **Needs attention**, red **Not working** — so tidying the panel never hides a problem.

- **Take an intake from the phone to the calendar without leaving the desk.** Intake, in the sidebar,
  lists every intake and consultation your firm has in flight — who it is for, who carries it, and
  how far it is against your intake procedure. New Intake records the caller and the matter, with no
  number yet; if the caller is not in your directory, the client field's New button records them there
  and then, and the same button now stands beside every field where a person or an organization is
  chosen. Open an intake to answer its steps; when every required step is answered, Complete Intake
  makes it a consultation and gives it its consultation number; and Schedule puts the consultation on
  the calendar with the client and the attorney already on it. A matter's status now reads Intake,
  Consultation, Active, On Hold or Closed. An active matter the firm has stopped working without
  ending it — a client who has stopped paying, a party who has gone quiet — goes On Hold from its
  status window, with the reason in a sentence; it keeps its number, stays on the docket, and Release
  Hold makes it active again. Your intake procedures can now name
  two more kinds of step: the forms the client fills in online, and a payment sent or received.
- **Write what a kind of matter must clear before you take it on, and Magna Carta holds the door.**
  Under Settings · Intake Procedures, list the steps a consultation of each kind has to clear: the
  conflicts check, the fee agreement, the engagement letter, the retainer, the questions the client
  has to answer, the documents they bring, and anything a member confirms by hand. Each consultation
  shows its own Intake section with every step answered by whoever holds the fact, a member records
  the ones only a person can, and the matter opens only once every required step is answered or a
  member who may waive one has recorded why.
- **See everything that has happened on a case, in one place.** The matter's new Activity section is the whole story in date order: email saved to the matter, documents added and assembled, hearings and deadlines, time and costs booked, client money moved, items in your custody, conflicts checks, the notes your firm wrote, and the day the matter opened. It is the screen to open when you pick up a file you have not touched in months, and the one to read from when you need to account for what was done and when.

**Every row says what the thing is, in its own words.** A document gives you its name, what kind of document it is, its size, its version and whether the scanner has held it back. A note gives you its opening line and when the thing it describes happened. Time gives you the narrative and the hours; a cost its description and amount; a hearing its title, time and place; a deadline its title and whether it is overdue. You read the case down the page without opening anything, and what you may not read on the matter is left out rather than hidden behind a vaguer word.

**Find it, then open it.** Sort by any column, right-click a column heading to filter it, hide it, pin it or bring another back, and the footer tells you how many rows a filter is hiding. Narrowing to one part of the matter is the Section filter; narrowing to one kind of thing is the Type filter; narrowing to one person is Who. Each row opens the thing it describes, in the section that holds it.

**Write a note from here.** "+ New Note" opens the same window the Notes section uses, and the note takes its place in the chronology the moment it is saved.

**The Overview starts with it.** The matter's Overview now carries its most recent activity, with the whole chronology one step away.

- **Matters is now your firm's docket, and you can open a matter from it.** The screen used to say
  "No matters yet" whatever your firm held, and the "New matter" button never worked. It now lists
  every matter the firm has, in a table you can sort, filter by any column, search, and rearrange to
  suit how you read a caseload. Press a matter's title to open it, or hold Ctrl (Cmd on a Mac) to open
  it in a second tab.

**Showing** switches between the working docket, open matters, closed matters, and consultations.
Consultations sit apart on purpose: a file the firm has not taken on yet carries no matter number,
and counting it in the live caseload would overstate the firm's work.

**New matter** opens a real one. Give it a title and choose whether it opens straight away, drawing
the firm's next matter number, or is recorded as an unnumbered consultation while the firm decides.
The client, the practice area and the office are all optional and can be filled in later from the
matter itself. Matter numbers are issued by your firm's own numbering scheme and are never typed by
hand, so two people opening a matter at the same moment can never be given the same number.

Two things the screen does not do yet, and says so rather than pretending otherwise: it cannot show
which attorney is responsible for each matter, and a new matter always opens under the person
creating it. Both wait on the firm member directory. If opening a matter is refused because your
firm has not set up a numbering scheme, the message now points at the settings page that does it.

- Notifications you can actually see, and settings that decide which ones are worth your attention.

The platform has been writing notifications for a while — deadlines falling due, tasks assigned to
you, movements on client money, a file quarantined by scanning — and until now there was nowhere to
read them. The bell in the top bar is live: it carries a real count of what is waiting, and opens on
the newest few. **Notifications** is the full list, narrowed by category or down to just what you
have not read yet, with the record behind each item one click away. Following an item marks it read;
dismissing one is a separate, deliberate act, because having seen something and having dealt with it
are different statements.

**Settings · Notifications** is where you decide what reaches you, category by category: whether it
appears in the application, and whether it joins a daily or weekly summary email or none at all. Your firm can require a category in the application — trust and security are
always on — and where it has, the row says so in words rather than leaving you with a switch that
silently refuses to move. Your firm can never raise what your mailbox carries: by email the choice is
yours.

A category you turn off writes nothing at all rather than hiding something you might later stumble
on. So that the difference between "nobody told me" and "I asked not to be told" stays visible, the
count of what your own settings have stopped is shown beside the switch that stopped it. The list
also tells you when notifications aged out of it while still unread, rather than showing you a
reassuring zero — everything they pointed at is exactly where it was.

Summary emails still carry counts only: how many items are waiting, in which categories, and a link.
Never a matter name or number, a filename, a subject line, a date or an amount. They also cannot
reach anybody until your firm's outbound mail is provisioned.

- **Decide what your matter numbers look like.** Under Settings › Practice › Matter Numbering, write
  the shape of your matter numbers and your consultation numbers as a list of parts: a prefix, the
  year, your office or practice-area code, the client's code, and the counter that ticks up. Any part
  taken from the matter can restart the count, so each year or each practice can have its own run.
  Start from a common shape, watch the preview render as you go, and save. Numbers already drawn stay
  as they are. A court's number or a number from your old system goes on a matter by hand from its
  status window, under Number.
- **You can now open any state's official attorney register from Tools.** Choose a state and Magna Carta takes you to the page where that state verifies a lawyer's licence and standing — the bar association's directory in most states, the judiciary's or disciplinary board's search in the rest. All fifty states and the District of Columbia are covered.

Magna Carta does not look the lawyer up for you and does not keep what you find. The register is the authority, and standing can change the day after you check, so you always read it live and first-hand. Where a state publishes its register without encryption, the screen tells you before you go.

- **You can turn off the gold marks at the edges of lists and tables.** Settings · Accessibility · Scroll Edge Markers.

They are the thin gold lines that appear above and below the sidebar, and to the left and right of a table, while there is more to see that way — useful when a list hides its scrollbar, and one more thing moving at the corner of your eye when you would rather it did not. Turning them off changes nothing else; scrolling works exactly as before.

- Tasks are now ready to be connected to another tool.

Magna Carta does not connect to ClickUp, Asana or anything else on its own, and nothing in the
product will offer to. What it now has is the groundwork an **add-on** needs, so one can be built
without changing how tasks work.

A task can carry its identity in another system, and when it does, the task's row says so and links
straight to it. A task can be mirrored into more than one tool at once. Editing on either side is
possible, and the record keeps enough to stop the two copies fighting — including who changed a task
last, so an add-on can tell its own updates from a person's.

Deleting a task is handled properly rather than quietly: the record keeps a note that it existed and
was deleted, so a connected tool learns the work is gone instead of leaving it on somebody's board
forever.

An add-on only ever sees what the person it is connected as can see. Connecting one does not open a
side door to matters that person has no access to.

- **A time entry now shows everything the firm recorded about it.** The listing and the record window carry the resolved rate and where it came from, the billing codes with their names, who entered the entry and when (which delegated entry makes a different person and day from whose work it was), the invoice a billed entry rides, and the entry's own reference number.

**Every new entry gets a permanent number.** It is the matter's number plus the entry's place in that matter's sequence — `2026-0147.0042` — assigned when the entry is written down and never changed or reused; a voided entry keeps its number. Entries recorded before numbering existed show no number rather than an invented one.

**Entries carry an internal memo, files, and their own history.** The memo is for the firm alone — it never appears on a bill or anywhere a client can see, and the record of an edit never quotes it. Files already in the matter can be attached to an entry and removed again without touching the file itself. The entry's history lists what happened to it — entered, edited, approved, kicked back, voided, files attached — with who and when.

**An entry recorded in the wrong ledger can be converted to a cost.** One action creates the cost carrying the entry's description and amount and voids the time entry, so the charge exists exactly once; both records note each other. An entry already on a bill, already void, or without an amount refuses with the reason.

- **You can now always see what version of Magna Carta you are on.** A small chip at the top right
  of every signed-in screen shows the web application's build. Click it to open the version overlay:
  the web app, the server, and each backend service, each with its build, when it was made, and
  whether it is reachable, and any value copies to your clipboard in one click for a support
  request. When the web app and the server are briefly on different builds after an update, the
  overlay says so plainly.
- **You can now see which version you are on before you sign in.** The version chip has moved into the
  top right of the sign-in page, the password-reset page and the registration screens, so you can read
  your build identifier, and copy it into a support request, from the screen that is refusing you.

Signed out, the overlay shows the web application only, and says so. The API and the backend
services report their versions once you are signed in, so nothing is missing there and nothing is
wrong: sign in and open the chip again for the full picture.

- **Time in the sidebar now opens.** It shows the firm's time over a period — every hour recorded, across every matter and every timekeeper, for the days you choose.

Pick a span: today, yesterday, this week or last, this month or last, or any range on the calendar. Pick whose: your own by default, and, where your account may read the firm's time, any colleague or everyone at once. Both choices are in the address, so a partner looking at somebody's month sends that view by sending the link.

The strip under the table says what the period holds — hours recorded, how much of it bills, what is still unbilled and what an invoice has taken up — and follows your filters, so narrowing to one matter makes the figures speak for that matter. Every column carries its own filter, reached from the column's own heading, and the counts say how much they left out. A row opens the same entry record the matter's Time tab opens.

This is the read surface. Capture has not moved: the Time Sheet in the top bar still opens over whatever screen you are on, so writing a row never costs you your place. The week grid — matters down the side, days across the top — is the other half of this screen and is still to come.

- **Trust is now in the product.** Open a matter's **Trust** section to see its trust ledger: every deposit, every payment out and every transfer between the client's matters, with the balance, what is under hold and what is available. **New Deposit** records money received; **Pay Out** proposes a payment, which is made at once when your firm's policy lets you release it alone and otherwise waits for a colleague who can; **Transfer** moves money between two of the client's matters. A payment waiting on approval shows at the top of the ledger with the verbs the right person needs. In the sidebar, **Trust** opens the firm's trust accounts: open one against an office, and for each account see the payments waiting on approval and decide them, the statements and reconciliations on record, the firm's bank-charge cushion, and the firm's policy on who may release client money.
- **Reconcile a trust account, and see where it stands.** On the firm's **Trust** screen each account now states its position: the bank's book balance, what the client ledgers come to, what is under hold, and the firm's own bank-charge cushion. **Record Statement** enters a bank statement with its lines; **Import Statement** reads one from a file and shows you exactly what it found before anything is stored. **Reconcile** opens a reconciliation on a statement: the proof at the top, the bank's unmatched lines on one side and your recorded items on the other, suggested pairings marked with their reasons, and you record each match yourself. Closing freezes the proof, whether or not the period balanced. The cushion can be opened, funded and charged from the same screen, and **Unclaimed Funds** lists the client ledgers that have sat quiet since a day you choose, with the diligence file for each: the review, every attempt to reach the owner, and how the round ended.
- **Turn on two-step sign-in from your account.** On Security, add an authenticator app — Google
  Authenticator, Microsoft Authenticator, 1Password or any other — by scanning a QR code or typing a
  key. From then on, signing in asks for the six-digit code it shows as well as your password. You get
  ten recovery codes for the day you cannot reach your phone; save them as a file or copy them into your
  password manager. You can replace the codes (the old ones stop working at once) or turn two-step
  sign-in off again, each with your password. Nothing changes about how you sign in until your app has
  proved it has the code, so an attempt that goes wrong partway leaves your account exactly as it was.
- **What is said in a meeting's chat now stays on the file.** Chat used to be nowhere: it did not
  exist, and when it lands in other tools it usually disappears when the meeting does. Here a
  conversation in a meeting on a matter is part of the matter's record, read later like any other
  correspondence on the file.

**You can take back something you said**, and so can whoever is hosting. The message goes; the fact
that there was one, and that somebody removed it, stays — which is what makes the rest of the
conversation something anyone can rely on.

**The transcript reads from the beginning of the meeting**, and it is there for everyone who could
have joined, not only for the people who were typing.

- **You can change your firm's name from Settings · Firm Profile.** It is what clients see: on invoices, in the client portal, and on every document the platform generates.

New documents carry the new name from the moment you save. Documents already produced keep the name they were produced under — nothing is reprinted, and the page says so before you save rather than after.

Only an owner or administrator can change it; everybody else sees what the firm is called. The change is recorded in the firm's audit log against whoever made it.

An address, a telephone number and a letterhead belong to an office rather than to the firm as a whole, so they stay under Offices — where a document actually reads them from.

- **Choose where your downloads go.** In **Settings · Downloads**, pick a folder once and exported files
  are saved straight there. Not every browser lets a website choose a folder — Chrome and Edge do; in
  Firefox and Safari the page will tell you to switch on your browser's own "always ask where to save
  files", which does the same job. Either way your file always arrives.
- Time entries can now say which task they were for.

Open a time entry and pick the task in the **Task** field. It offers that matter's open tasks and
nothing else — time on one matter cannot be work on another matter's task. Most entries will name
none, and that is fine: time is recorded against a **matter**, and naming a task is an extra you
choose when you want to know how long a particular piece of work actually took.

The task then shows it. **Time logged** appears in the task's row with the total — minutes, not
money, because what a task was billed for is a billing question asked on a billing screen. If you
are allowed to see other people's time the total is the whole task's; if you are not, you see your
own and the row says **by you**, so the number is never mistaken for the whole.

One task per entry. If a block of time served two tasks, record two entries — splitting one entry
between tasks would mean deciding how many of its minutes went to each, and that is a second set of
books. Starting a timer from a task is not built yet, and a task never carries an estimate the
product quietly compares against the real time.

- **Your name is yours to set, and it now has proper parts.** Account · Profile is live: prefix, first, middle, last and suffix, with the line they read as shown beneath so you can see exactly how you will appear before you save.

If your account was made before this existed, it holds the one name you typed when you signed up. The page shows you how that reads as parts and asks you to confirm or correct it — nothing is stored until you press Save, because guessing at somebody's own name is not something software should do quietly.

Prefix and suffix both take several: "III, Esq." or "M.D., Ph.D." Pick them from the list one at a time, or type the line yourself.

Changing your name updates it everywhere in your firm — the roster, and every screen that names you on the work you did.

### Changed

- **Messaging: a call or a text can be opened, corrected, and set aside as something that belongs to no matter.** The screen moved to `/messaging`, which is what the sidebar has always called it.

**The form asks plainer questions.** Type and Direction instead of Kind and Which way — and both now show their own words, since a select that had not been opened yet was rendering the value the database stores, so the form opened reading "voice" and "outbound". The date and the time are two fields rather than one combined control, because changing the day of a call recorded this morning should not mean stepping through a clock. What was said is the **description** on a call and on a text alike; the two used to be asked for under different names and laid out differently, and they now look the same, because they are the same record. The button says Save.

**A picture message is a text.** It was a third thing to choose between, which is one decision more than anybody makes: a picture is something a text carries. The record still knows the difference and says so beside the row.

**The number carries its country.** A dial-code control sits beside the digits, they group as you type in that country's own form, and the record stores the international number — so an area code lands where the eye expects it and a number reads back the way a phone would show it.

**You can say who you were talking to.** Picking a contact from the directory fills in their number, and a call that names a contact can start an **intake** for them without leaving the record: the matter opens with the caller already filled in, and the call is filed onto it.

**Not every call is a case.** Spam, a wrong number, the landlord, an enquiry that never came to anything: none of them can be filed onto a matter, and until now they sat in the queue forever. A record can be **set aside** with a reason — spam or wrong number, firm business, nothing came of it — which takes it out of the queue without pretending it was a matter. Nothing is deleted, and a firm that decides a written-off call was real work after all puts it back.

**A row opens.** Double-clicking one used to jump to its matter, or do nothing at all. It now opens the record: read it, correct it, print it, file it, set it aside, or start an intake from it. A record the carrier wrote is not editable, and says why.

**Searching the log** now matches the matter's name and number as well as the words and the number dialled.

- **Columns are now changed from the column itself.** Right-click any column heading for everything it can be asked: **Filter** narrows by that column, or hide it, pin it so it holds its place when the table scrolls sideways, or open **Columns** for the full list — every column the table can show, row striping, and any settings that screen adds. The separate **Columns** button and the small funnel in each heading are both gone; a column that is being filtered is marked in its heading, and hovering the mark says what it is narrowed to.
- **Every conflicts check now has a number — CC-0001, CC-0002 — and keeps its history.** The number is drawn the moment you open a check and is how it is referred to on its own screen, in the log and on anything printed. **Run Again** on the check's screen searches again as a further run under the same number; an automatic re-check lands under the matter's own check; and the screen lists every run with when it ran and what it came to, showing whichever one you open. While a run is under way the screen says where the search is and what it has counted so far, stage by stage. A check run before there was a matter can be filed on one from its screen, and the report's two controls are now exactly **Print Report** and **Download Report**, the second handing you the same sheet as a PDF.

**The New Check panel says less and asks by place.** Its right side is two tabs: **Locations** lists where a check searches — Directory, Files, Messaging, Magnus — with what the Directory search does beneath it behind a caret, and a place that cannot be searched yet is shown disabled, marked Soon, saying what it waits on. **Advanced Settings** holds name matching, now a dropdown whose rows show a name each choice would catch. Once you have chosen a party, the matter field offers the matters that party is on first, with the rest of the docket searchable beneath.

**Nothing limits a check any more.** "How far to follow relationships" and the two limits are gone from the panel and from **Settings, Conflicts**: every check follows every recorded relationship as far as the chain goes. The one bound left is the platform's own ceiling on a single search, far above any real corporate group, and a run that reaches it says so on its record.

- **Park or decline a consultation from its own page, and change any matter's status from its
  badge.** A consultation the prospect is still thinking over can be put on hold, with a reason, and
  released back to a consultation; one the firm decides against is closed with Close Consultation and
  keeps its consultation number without using up a matter number. Pressing the status badge on any
  matter now opens a short menu of what the matter can do from where it is — open, hold, close,
  release or reopen — and the step you choose either opens the status window at that step or, where
  nothing needs reading first, simply asks and goes. The status window is still there, one item down
  the same menu, for the number, the engagement and the physical file.
- **Opening a person or an organization no longer takes you away from what you were doing.** From a matter's parties, from the client on a matter's overview, from a conflicts check or from the Directory itself, the record opens in a window over the page, laid out the way it was when it was recorded, with its sections down the left side. Close it and you are back exactly where you were. Opened from a matter, the window also lists the roles that record holds on the matter. A record's address still works: following one opens the Directory with that record's window already open.
- **Uploading a file your firm already has now files it.** Two identical files you chose both
  arrive; a file uploaded twice is there twice — the copy is made without sending the bytes again,
  and the row says where it came from. **A taken name is your call:** by default the new file is kept
  beside the other under a numbered name; under Advanced Settings you can have such files filed as
  the next version of the file that has the name, or skipped. The Name Taken column shows which files
  are asking, and the Name Taken menu above the list answers for the files you select.
- **A document's details panel reads as tables, and a safety check can be run again.** Version
  History is a table: version, date, size and who created it, with each row's controls beside it.
  The Hashes tab computes the fingerprints as it opens, for the version chosen in its dropdown, and
  a new **Compare Against a Digest You Were Given** field takes a typed or pasted digest, or a file
  from your device, and says whether it matches. The Safety tab lists every check the document has
  had, with when, which version, which engine and what it found, and **Check Again** asks for a
  fresh one; **Re-run Safety Check** on the right-click menu does the same for a selection.
  **File's Own Date** is now **Source File Date**, with what it means beside it. A document with no
  document type no longer carries an Info safety mark.
- **When a record will not save, the fields that need answering now say so.** The reason still appears next to the button, as it always has — but the field it is about is marked too, with the same sentence underneath it, so you are told where to go rather than only what is wrong.

Nothing is marked while you are still filling the form in. The marks appear the moment you try to save and cannot, and they clear when the record goes in. A field with two things wrong with it shows the first, because fixing that one usually settles the other.

**And the calendar can be narrowed to the kinds that matter.** The list on the left says whose calendars you are looking at; the new **Kinds** control at the top says what sort of thing — case settings, deadlines, firm events, or dates from the register. Not every week needs all four at once.

Every kind is shown until you say otherwise, so the first press takes one away rather than leaving you with one. **Show Everything** puts them back, and appears only when something is being held back. Turning all four off shows you everything rather than an empty calendar.

- **A window opened over the application now keeps a margin of screen around it on every side.** On a laptop, a long record or a long form used to run from the top edge of the screen to the bottom edge, and the widest windows touched both sides too. Every window, dialog and question now opens inside a margin on every side: one that fits is exactly as tall as what is in it, and one that does not fit stops at that margin and scrolls inside. Filling the screen is still one press away, and still fills it to the edges.
- **Every panel now tells you which record it is about.** The line under a panel's title is the record's own number — the matter, the bill, the message, the packet — instead of a paragraph explaining the feature. Where a record is numbered only when it is saved, the panel shows the number it is about to take and says so, so you can write it down while you are still on the telephone.
- **Notes now say when something happened, not just when you wrote it down.** A note typed on Thursday about a call on Tuesday can say Tuesday, and the matter's history puts it there, beside whatever else happened that day. Add a time if you know it. Notes that describe no single moment, like a standing instruction, simply leave the date empty.

**Edit and delete work the way you expect.** Editing a note replaces its text; deleting one removes it. Both are plain and immediate. Two things to know: an edit does not keep the previous wording, and a deleted note cannot be recovered by anyone, including your administrator.

**Attach the matter's documents to a note.** Point a note at the letter it discusses or the draft it reviews. The document is not copied or moved: it stays in the matter's files with everything that comes from being there, and one document can be attached to several notes. Deleting a note never deletes a document.

**The composer shows what it is about to store.** Before you type, you can see which matter the note lands on, whose name goes on it, and the moment it will be stamped with.

- **Notes open in the same window as everything else.** A note is written, read, changed and deleted in the record window you already know from time and costs, and clicking a note in the list opens it there. Starting one is **New Note**.

**Say when it happened, on one line.** The date the thing happened and the time on that date sit side by side. Leave them empty for a note that describes no single moment.

**Attach a document while you are still writing.** Pick from the matter's files as you write; the documents are attached when you save the note. The document is not copied or moved — it stays in the matter's files, exactly as before.

**Print a note.** A note's sheet states both times it carries — when the thing happened and when it was written — along with who wrote it, who last changed it, and every document attached.

- **Numbers arrive before the save, not after it.** Opening a matter, recording a consultation or logging a custody packet now tells you which number the record will be filed under while you are still filling the form in — and says plainly that the number is drawn when you save, so nothing is held for you. Recording a call already worked this way; now the rest do.
- **Saying what someone is at a hearing no longer means guessing what to type.** The role beside each person on an event now offers the roles that actually come up — appearing counsel, judge, court reporter, interpreter, expert witness and more — while still letting you type anything your practice needs.

**The same role is now spelled the same way every time.** Typing "court reporter" where "Court reporter" is already offered records the offered spelling, so one role stops turning into three and narrowing a list by role finds all of it.

- **Prefix and suffix are now chosen from a list, and you can still type your own.** Wherever a person's name is entered — a new contact, an existing record, your own profile — the Prefix and Suffix fields offer the forms a firm writes constantly, judicial and legal ones included: Hon., Judge, Esq., Jr., III. Type to narrow the list, or type something that is not on it and add it as it stands.

It is a small thing that prevents a persistent one. "Jr", "Jr.", "JR" and "junior" are one suffix spelled four ways; they read as four on a letter and sort as four in a listing, and nobody proofreads them. Offering the written form keeps a name record consistent without anybody having to.

- **Tasks open in a window, and you change them where you read them.** Press a task's own words to
  open it: everything it carries is in one place, and **Edit** turns what you are reading into fields
  without going anywhere else. Attaching a document, recording that the firm decided against the work,
  and deleting a task are all there too. Making a new task opens the same window with nothing in it
  yet. The list keeps what a list is for — seeing what is owed, and pressing **Done**.
- **Tasks now move along four rungs: To Do, In Progress, On Hold, Done.** They are one row of controls
  at the bottom of a task's window, and the one it is on looks pressed, so you can see where anything
  stands at a glance. Done is on the list too, beside each row, because ticking finished work off is
  what a list is for. Moving a task off Done puts it back where it was rather than at the start.

**Cancelling is gone; archiving replaces it.** Archive keeps the task and everything it carries, and
**Show Archived** brings it back into view whenever you want it; **Put Back** returns it to the rung
it left from. You can say why you archived something, but you no longer have to. Delete is still
there for a task that should not exist at all — it removes the task for good.

- **The Excel export now comes your way.** Download it with each table on its own worksheet or
  everything on one sheet, whichever suits how you work. Every file opens by saying exactly when it
  was generated, and the file's name now reads plainly: the report's name, the date, and the time.
- **Account Settings says less and does more.** The muted line under every row's name and the sentence
  under every page's heading are gone — the surface was explaining its own headings back to you. What
  replaced the explanations is the things they were explaining being built:

- **A photo.** Choose a PNG or a JPEG on Profile and it is yours across the firm; change it or remove
  it from the same plate.
- **A password change.** Security changes the password you already have, with no emailed link — and
  signs your other devices out in the same act when you ask it to, which is the thing that matters on
  the day you think somebody else has your account.
- **Your email address**, stated on Identity. Changing it is not offered yet: it is the address you
  sign in with and the one every pending invitation is addressed to, so it is a piece of work rather
  than a field, and a greyed-out box beside it would have claimed otherwise.

**Active Sessions shows where each device signed in from.** It never had — every row said "Address
not recorded", because the site was reading a header it is never sent. A device whose sign-in
genuinely carried no address now simply has one fewer thing said about it. The notice at the top of
that screen has gone too: it told you to go and find a password reset, and the password change is
now one click away on Security.

- When something goes wrong in a matter's files, the screen now tells you what happened and what to try. It says up front that your record is unaffected, shows the time and an Error ID you can quote, and offers three things worth checking before you call anyone.

If you do want to report it, Report a Problem shows you exactly what will be sent before you send it — and none of your documents, file names or matter details are included. A screenshot is only attached if you tick the box.

- **The people whose records you are reviewing are called Custodians of Record.** Same idea, clearer
  name: when you say whose files a load came from, that is the Custodian of Record. It stays distinct
  from the safe custody register, which is about physical originals the firm holds — you will meet
  both in one matter, and neither is ever shortened to just "custodian".
- **Every discovery screen searches now, and it searches the whole record — not just what is on
  screen.** The magnifier sits in the row above the table on Discovery, on a review set's Documents and
  on its Loads. Type and the list narrows; the X or Escape clears it; "Show Everything" brings back
  what a search and a filter were both holding out.

On **Documents** it searches what each document is called — its name and the path it sat at in the
production — across the whole review set, and it combines with whatever you have narrowed to rather
than replacing it. What you searched goes into the address bar with the rest of your narrowing, so a
searched queue is still a link you can send to somebody else on the review set. Searching the words
INSIDE your documents is **Keyword**, in the Narrow control, and it is still waiting on the search
engine; the two sit next to each other so they are never confused, and the search field says which
one it is.

**Loads has one New control instead of two buttons.** New Load and New Custodian of Record are
choices under it, in the same place every other screen keeps the way to make something. If one is not
available to you, it says why rather than disappearing.

**You can start a review set from the Discovery screen.** It asks which matter it belongs to — a
review set always belongs to one, and the matter decides the document limit it carries and the
lifecycle it lives under. Starting one from a matter's own Discovery section works exactly as before
and asks nothing, because there the answer is already known.

- **Your Downloads screen is now a proper table.** Sort it, filter it, and turn on the columns you want — the size, the format a report was made for, the day a copy stops being available — and it remembers how you arranged it. Search finds anything you have ever downloaded, not just what is on screen, and every row says plainly whether you can still have it.
- **Attorney License Lookup now shows every state's register at once.** The screen used to ask you to
  pick a state before it would show you anything. It is a table now — all fifty states and the
  District of Columbia, the authority that keeps each register, and whether that register is served
  over an encrypted connection. Choose a state's name to open its register in a new tab, or
  double-click anywhere on the row.

Sort by any column, and right-click a heading to narrow by it — including **Connection**, which
brings you straight to the two states that publish their register unencrypted. The same menu turns
on an **Address** column showing each register's full web address, in case you want to copy one.

- **Everything you download now shows up in Downloads.** Files you take from a matter, bundles, converted files and exports all appear there, not just exports — and the record stays after the copy we were holding for you has expired, so you can still see what you took and when. Anything still available carries a Download; a file you took from a matter goes back through the matter, so it stops being available to you if your access to that matter does.
- **Every main screen now says its name the same way.** Each one is headed by exactly the name you
  clicked in the sidebar, with nothing above or below it — the way Matters always looked. Home is now
  Home rather than "Good morning", and the Notifications screen is titled Notifications rather than
  "Notification Center". The one-line descriptions under a handful of titles are gone; they repeated
  what the title already said and cost a working screen a row of space. Lines that tell you something
  real stay put, like the date on Home and the seats in a room.

**My Work is now called Tasks**, matching the Tasks section inside a matter — one name for one
thing. It works exactly as before. If you had dragged My Work to a particular spot in your sidebar,
Tasks will be back at its default position; everything else you arranged stays as you left it.

**Nothing worth knowing was lost.** Where a line under a title told you something real, it moved to
where it matters rather than disappearing. The safe website viewer's reminder that a page opens in
an isolated browser and never loads in yours now sits at the address bar, next to where you type.
Each settings page still opens with the line describing what it governs — it just reads as the first
line of the page now, above the settings themselves, instead of in the header band.

- Every number your firm draws now lives on one settings page, **Settings › Practice › Numbering**:
  matter, consultation, intake, conflicts check and custody numbers are each yours to shape, and
  the invoice, time entry and call numbers are listed with their fixed shapes so the page is the
  whole inventory.
- Conflicts check numbers are now drawn from a scheme your firm can change. The built-in shape is
  `CC2026-00001`, restarting each year with five digits, so the busiest sequence a firm has keeps
  the width you expect; checks numbered before this keep the numbers they had.
- Every member can see the page. What is in force for each sequence is stated as a fact, with
  Request a change beside it; only an administrator changes a scheme.
- Custody packet numbers are yours to shape as well. Nothing already labelled changes: the built-in shape
  is the `CUS-00001` your labels already carry.
- **Every enquiry now has a number from the moment you write it down.** An intake gets its own number — `I2026-0001` unless your firm sets a different shape — so you can quote it to a caller, write it on a slip and find it again, without waiting for the file to become a consultation. When it does become one it gains a consultation number, and when it opens it gains a matter number; it keeps all of them, so an old note quoting any of those numbers still finds the file.
- **Every screen you open from another screen now shows you the way back — and says where it goes.**

Opening a person from the Directory, or a conflicts check from the register, used to leave you with the browser's back button and the sidebar. That is fine until the screen arrived some other way — from a link a colleague sent, from a search result, in a fresh tab — where there is no history to step back through.

The way back sits at the top left of the screen, above its title, and it shows the destination the way the sidebar shows it: the same small mark, the same name. Back to Matters, back to the Directory, back to Conflicts Check. You can tell where it lands before you click it.

Screen titles across the application also read the same way now, in the same place, at the same size — the headers had drifted apart one screen at a time, and they have been brought back together.

- **Every screen under Workspace searches itself the same way: one control, in the top right of the title row, resting as an icon until you press it.**

Matters, the Directory and a matter's Notes each had their own search box before this. They looked close enough to pass, and they were not the same — each had its own idea of what pressing the icon on a live query should do, and two improvements made to the shared control in September had reached none of the three. All three now use the one control, so the next improvement reaches them with everyone else.

Six screens gained a search they did not have:

- **Downloads** and **Uploads** narrow as you type; both already hold everything they list.
- **Magnus** finds a conversation by what you asked in it, not just by a title you probably never gave it.
- **Conflicts Check** finds a run by the matter it was made against or by a name it surfaced — so "has this firm ever checked this person" is one search rather than an afternoon.
- **Notifications** searches your whole feed, not just the part already on screen.
- **The Calendar** narrows the dates you are looking at, and says so: it tells you how many entries in that month or week match, and that other dates were not searched, so you know to move the calendar rather than assume there is nothing there.

Home has no search, and is the one screen that does not: it is a summary of your other screens, and the way to search from it is the search box in the top bar, which goes anywhere in the app.

- **Exporting now gathers instead of scattering.** Choosing a format adds the report to your Downloads
  rather than dropping a file straight into your downloads folder. Gather as many as you like, then
  tick the ones you want and take them all at once — they arrive as a single zip, each in the format
  you made it for. If you preferred the old way, **Settings · Downloads** has a switch to save the file
  as soon as you export, and the item still lands in Downloads either way.
- **A simpler File Analysis view, and a steadier file manager.** The row of buttons above the File
  Analysis table is gone — filter with the Safety column instead, the same way you filter every other
  column. The report download and the ignored-issues toggle now sit in the bottom bar. Opening a zip
  also keeps the top of the screen exactly where it was: the zip's name, its folder trail, the
  extract control, and the close control appear on their own line just above the bottom bar, which
  keeps all of its usual tools.
- **The matter file surface follows the settled design.** Fees now stands beside Time and Costs as
  its own section, navigation and counts sit with the file list, the side panels read as panels and
  hand their space to the list when collapsed, the folder tree's right-click carries the full file
  menu, and uploads start the moment files are picked — with per-file progress while you choose the
  destination, and failures that name the stage and quote the Error ID.
- **Menus and lists open where you expect and stay on the screen.** A dropdown list or a menu now
  lines up with the right-hand edge of whatever you clicked and never runs off the right of the
  screen; a long entry wraps inside the list instead. Right-clicking inside a dialog — the file list
  in the Upload window, for one — now shows its menu on top, where it can be used.
- Live mode in the Safe Website Viewer now shows the isolated browser's screen as it happens, and you can use it: click buttons and links, scroll, open menus, and type into search boxes, while the site still runs on the isolated computer and never on yours. The address bar follows where the page goes, back and forward move through the pages you visited, and the tabs on the right update with each new page. Pop-ups open in the same screen, downloads and uploads are blocked, and messages a page pops up are closed for you. Never type a real password into a page you are checking.
- **Menus open as you point at them.** Resting the pointer on a menu control — Money or Record on a matter, a New or Actions button, the account menu — opens it without a click, and it closes once you move away. Clicking, tapping, and the keyboard still open a menu exactly as they did.
- **Uploading now asks before it sends.** Choose Upload and a dialog opens where you pick a file, several files, or a whole folder — drag them in or use the buttons — and choose the upload location. Nothing is sent until you press **Upload**; cancelling before that sends nothing. A folder is recreated where you put it, with everything inside. If a file does not upload, its line says **Upload failed** and why. And when a download fails, a **Retry** button now appears beside it on the Downloads page and in the downloads tray.
- **Making something new is now the same gesture on every screen.**

On a matter, the **New** button sits at the top right beside the search and says what it will make on the section you are on: **New Fee** on Fees, **New Cost** on Costs, **New File** on Files, **New Note** on Notes, **New Packet** on Custodian. It is the same size on every section, so the search beside it never moves, and it stays on the screen even when nothing can be made right now: it is greyed out with the reason as its tooltip, rather than disappearing.

Where a section offers more than one thing to make, the button opens a short menu: on Files, a new document, a new folder, or an upload. Where a section does not make anything yet, the button says what it is waiting on.

The Matters list, the Directory and the Custodian register use the same button in the same place, and the Custodian register gains a search beside it, so the pair reads the same way wherever you are. The create buttons that used to sit lower down each screen, and inside empty lists, are gone; the one at the top is the one.

- **Recording an event is one form now, and it asks what the event is for.** There used to be two — New Event and New Firm Event — so you had to decide which kind of thing you were recording before you had opened anything, and start again if you chose wrong. Now there is one **New Event**, and the first line asks whether it belongs to **a matter** or **the firm**.

Choose **a matter** and the matter picker appears beside it. Choose **the firm** and you are asked the two things only a firm event needs: who sees it — everyone at the firm, or just the people you list — and which office it is at, which is what tells the form which conference rooms are nearby. The court reference field disappears, because a firm meeting has no court.

Everything else is the same questions in the same order either way, which is what the two forms had stopped being.

---

**A date field inside a `FieldRow` needs a wrapper, and two of them did not have one.** A labelled `DatePicker` renders TWO SIBLINGS — the primitive's Root is a context provider with no DOM of its own, so the label and the segmented field come out side by side with nothing around them. `FieldRow` is `grid sm:grid-cols-2`. Unwrapped, "Starts" took the first column, the date field took the second, and Time wrapped onto a line of its own: the row `record-timing-fields.svelte` exists to keep straight was three cells in two columns (owner, 2026-09-16: "start time and end time fields look wierd"). The 2026-09-14 move onto `FieldRow` is what introduced it.

Both date fields are wrapped now, and so is the Repeats end date, which had just been written into the same trap. The gap is 4 rather than 8 because the date label carries its own 4 of margin, so 4 + 4 is the 8 the Time group beside it uses and the two labels sit the same distance above their controls.

The design system's own notes document this trap and name the thirteen consumers that wrap for it; it stays a quiet one because the label's margin makes the spacing look right in a flex column, where it is right.

- Every failure in Magna Carta now lands in the same place and says the same kind of thing. When a
  screen, a panel or an action cannot complete, you get what happened in plain words, an Error ID you
  can copy with one press, and — where we can offer one — the control that actually moves you forward:
  retry, sign in again, or ask for access to what you were refused.

Copy details puts the whole report on your clipboard: which version you were on, which page, which
request failed, what the service said, when it failed and when you copied it, your browser and
connection, and the last few things you did in the app. Anything we do not have is written as
missing rather than left out, so a support conversation never starts by asking you something the
screen already knew. If your browser refuses the clipboard, the block says so and stays selectable
rather than claiming it copied.

Report a Problem now files. It is reachable from the profile menu and the command palette on every
screen, it goes to your firm's own reporting pipeline and nowhere else, and it comes back with a
reference you can quote. No document, file name, client name or matter content leaves the firm.

Two failures that used to look like your fault no longer do. A read that fails while an update is
still rolling out says the service is mid-update instead of blaming the address you typed, and when
several reads fail at once one line at the top of the screen says so — once — with a link to the
service status page, instead of six panels apologising separately.

- **Press Enter to finish what a panel asks.** Pressing Enter in a panel's field now does what the panel's button does: writes off the balance, records the delivery, opens the packet. In a multi-line field, where Enter starts a new line, Ctrl+Enter (Cmd+Enter on a Mac) does the same. A button that cannot be pressed still cannot be pressed from the keyboard.
- **The panel is called Record Communication**, whichever kind you are recording. It used to rename itself the moment you switched between a call and a text, and the line under the heading explained the subsystem to somebody who had already decided to write a call down.

**It is two columns.** The facts of the call are on the left — what it was, who it was with, which number, when, how long, where it belongs — and what was said fills the right. Switching between a call and a text no longer moves anything on the form.

**Every list can be typed into.** Type, direction, the country beside the number, and where it belongs: start typing and the list narrows. The country list carries flags, and answers to the dial code, the country's name or its two letters.

**A number can be shortened.** Backspacing through the brackets and spaces used to do nothing at all, so the only way to correct a number was to clear the field and type it again. The field also shows the shape the country writes — `(XXX) XXX-XXXX` here, and its own grouping anywhere else.

**A call has a start and an end, and the duration works itself out.** Give the two times and the length follows; a call that ran past midnight is five minutes, not twenty-three hours. Length in minutes as a field you typed into is gone.

**Where it belongs is one field.** Type a matter's name or its number, or pick a reason it is on no matter, or leave it for somebody to decide later — all in the same list. You no longer choose a category first and then a matter.

**The number and its country are entered the same way everywhere** — the field the call log uses is the field a contact's telephone number uses.

**Two smaller things.** The description no longer carries a drag corner that only pushed the panel's own footer around, and the New button beside the contact field is gone: a contact you cannot find is still added from inside the list, which is where people were adding them anyway.

- **Signing up is now one short form.** Creating an account no longer starts by asking which kind of
  person you are. You give your name and email address, confirm it, set a password, and you are in.

**Then you say where you work, from inside the app.** A welcome screen offers the two things that are
real: **start a new law firm**, or **enter an invitation code** from a firm that has invited you.
Starting a firm takes a moment to build, and the screen says so and moves on by itself when it is
ready — you can close the page, and signing in again brings you back to wherever it got to.

**If you were invited, nothing you already do has changed.** You can still redeem your code without
making an account first; that path is unchanged. If you make an account first, paste the code on the
welcome screen instead — it has to be the invitation sent to your own email address, which is what
keeps somebody who has merely seen your code from joining your firm in your place.

**Coming back later costs nothing.** An account with no firm yet is a real account: it signs in, it
can reset its password, and it returns to the same welcome screen until you are ready to choose.

What the screens do is described in [Joining Magna Carta](user/features/joining-magna-carta.md).

- **Settings look and behave like one surface.** Every settings page now scrolls, spaces and lists the same way. Wherever a setting is a choice from a list you can type to narrow it, on every page. The tables under Users, Event Types, Rooms and Resources and both Notifications pages sort by their headers, filter from a right-click on a column, let you choose which columns you see, and count what they show. The Versions page shows exactly what the version chip at the top of the screen shows, with more room: every part of the platform, whether the page and the server agree, and whether your firm's records can be reached. Under Beta Access the switch stays off if you cancel joining, and the heading reads Beta Branch. Under File Safety the scan depth reads Core, Extended or Full, with the engine every upload is scanned by and what the chosen depth means shown beneath it. Under Matter Numbering the parts of a scheme are a table: move a part with the arrows at the start of its row, remove it at the end, and choose a common shape from the Matter Numbering Scheme field.
- **Folders in the calendar list collapse.** A firm with twenty conference rooms no longer scrolls past all twenty to reach the folder underneath. Press a folder's name to fold it; the tick beside the name still turns every calendar in it on or off while it is folded, and a folded folder shows how many of its calendars are switched on so nothing disappears quietly. What you fold is remembered on that browser.

**A small month sits under the list, and it stays put.** It shows where you are and takes you somewhere else in one press — and it does not scroll away when you scroll the list of calendars. Pressing a day moves the calendar to that day without changing your view: press a Thursday while you are reading a week and you get that Thursday's week.

**The screen's name now sits across the top of the whole page**, above both the list of calendars and the calendar itself, with search and New on its line. The view switch, the arrows and Today moved down to sit directly over the calendar they move.

- **The New Check panel now has two sides, and every setting says what it searches.** The left side is
  what you are asking — the parties, and the matter to file the check under if there is one — and under
  them, in plain sentences, what pressing Run Check will actually do: how far it will follow each kind
  of relationship, whether it can reach your own people, how names will be compared, and how the check
  will be filed. The right side is the search settings, each with a line under it saying what it
  searches, and you can leave every one of them alone.

**The settings are named for what they search.** Where a check looks is now **Name or identifier**,
**Relationship**, **The firm's own people** and **Documents and messages**. How widely it matches
names is **Name matching**, set to **Standard** or **Widest** — and both of those say out loud that
they match names that _sound_ alike, which they always did. How far it walks is **Ownership and
control**, **Family and personal**, **Representation** and **Corporate family**. Where it stops is
**Related parties to reach** and **Candidates to record**. Your firm's log, the settings screen and
the printed check all read the new words.

**A check does not need a matter, and the field says so.** A matter is where a check is filed, not
what it is checked against — finding the matters that might conflict is the point of running one.
Naming one adds that matter's own parties to the search and lets the check reach your own people.

**You are no longer asked whether a check is preliminary or comprehensive.** Those two words say when
a check ran, not how it searched, and your record already knows: a check filed against a matter your
firm has taken on is comprehensive, and every other check is preliminary. The panel tells you which.

**A number you leave blank shows the number it will take** — your firm's own setting, inside the box.

- **Tasks looks like every other screen, and the finished work is out of the way.** The search box and
  **New Task** are at the top right of the Tasks screen, in the same place as on Matters, Directory and
  Custodian. The **Done** and **Cancelled** tick boxes that sat above the list are gone: below the
  list, past everything you still owe, **Show Done** and **Show Cancelled** bring the closed work in
  when you want it, and read **Hide Done** and **Hide Cancelled** while it is showing.
- **Conflicts Check now opens on your firm's record of checks, and New Check is at the top right.**

The screen used to open on a long form, with the list of checks your firm had run pushed below it.
Now the list is the screen: every check across every matter, newest first, saying when it ran, what
set it going, who asked, whether it was filed against a matter or against parties named before a file
existed, how wide it searched, whether your firm's floor widened it, and how many candidates came
back. Narrow it from any column's own heading and clear that from the control beside New Check.

A check you ran by hand now says on its row that a person asked for it, and names them; before, the
row could only say it did not know what started it.

**New Check** at the top right opens the form in a panel — which matter if any, the parties, what to
search, how far — and nothing runs until you press Run Check. The same panel opens from **New Check**
on a matter, with the matter already filled in, so the matter's Conflicts tab now leads with where
that matter stands instead of with a form.

- The Directory's list shows far more than a name and a date. Email, telephone and city sit beside
  every record, and the header menu offers first, middle and last name, legal name, region, country and
  when a record last changed — so the book can be sorted by surname, narrowed to one city, or scanned
  for who the firm holds a number for, without opening a record at a time.

Recording somebody is easier to get right. A person with only one name can be recorded — their first
name is what the firm files and searches them under, and the screen says so rather than refusing.
Titles and post-nominals are picked from a list you can add to, and a person can carry more than one
suffix. An email address, telephone number or postal address that was entered wrongly can be
corrected in place instead of deleted and typed again. And an address is entered on its own section,
in the shape the country actually uses: an Irish address asks for a county and an Eircode, a German
one puts the postal code before the town, and neither is asked for a state.

- **Registering now asks for an email address and a password, and opening the confirmation email signs you in.**

The name fields are gone from the registration form. A name is part of your profile rather than part of getting in, and asking for it put two more boxes between you and the account you came for; until you set one, your account carries your address. The password is typed twice, because a reveal control has to be thought of and pressed, and a password mistyped the same way twice used to cost a trip through Reset Password before a first sign-in.

Confirming no longer ends at the front door. The confirmation code only ever reaches your mailbox, so proving you have it is proof enough: confirming signs you in and lands you on the welcome screen. Your password is untouched and still signs you in anywhere else, and if for any reason the sign-in does not come with it, the screen offers **Sign In** and the password you chose works on the first try.

The same round changed the wording around them. The tick box on the sign-in screen reads **Remember Me**. Every back control shows an arrow and names where it goes — **Sign In**, **Your Code** — instead of reading "Back to sign in". Check Your Email and the confirmation-code screen carry that control at the top of the card like every other screen. Reset Password lost the sentence explaining its one button, and the button reads **Reset Password**. And the welcome screen no longer greets you by name a second after you arrive.

- The document editor now fills the screen. Use the browser's Back to return to the matter for now.
- The document editor shows the document and its own tools, and no logo in the corner.
- **The event form is easier to fill in, and a colleague's calendar is one choice away.** The form is
  now four tabs — Details, When, Where and Who — and its first line offers a matter, the firm, or a
  staff member, whose own calendar the event lands on; the field beside that choice stays put
  whichever you pick. All Day is a switch. A setting that runs across days, such as a three-day
  trial, is drawn in the all-day band at the top of the week and the day, spanning its days, rather
  than across every hour of each. Every time zone reads the same way — "(UTC-08:00) Pacific Standard
  Time · Los Angeles" — in the list, in the field, on the record and on a printed sheet; the list runs
  west to east; and typing PST, pacific or los angeles finds the same row. An hour on the calendar
  carries its zone's code. Location offers your offices with their addresses, your rooms, and the
  organizations in your directory, and keeps an address you type. The people on an event are listed
  under Staff, Directory and Other. The day shown beside the form has a Calendars menu, so you can
  check one attorney's afternoon or one room's day before choosing a time. Picking the matter already
  chosen no longer empties the field, and a form asks "Discard Your Changes?" with nothing more under
  it. Closing a header panel by pressing its button again no longer leaves the button's hover text
  showing.
- **Find a matter's fee arrangement behind its status seal.** Press the status in the matter's masthead: the window now shows how the matter is engaged — the agreement the client signed, how it is billed, the terms, and since when — with the earlier versions a click away and Amend beside it. The Fees screen no longer shows the arrangement. When you record or amend the arrangement, you can name the signed intake agreement or amendment from the matter's files, and the window links to it.
- **The icon beside a document now shows what its name says it is, and File Analysis says whether
  that is true.** Before, a Word document renamed to end in `.do` kept its Word icon and DOCX label
  while the File Type column read `do`, and no check said anything. Now the icon, the File Type column
  and the type in words all read the name, an ending nothing recognizes draws a blank sheet with no
  label, and a name that disagrees with the document's contents is reported as a Type Mismatch, over
  every ending the icon knows. Opening a document is unchanged and still goes by its contents.
- The File Type column in a matter's Files list now shows the file's actual extension — "pdf", "docx", "mp4" — rather than a general category like "Word" or "Video". If a file's type is not known, the column is simply blank.
- **The help for the file tools now matches the product.** Hashing, metadata and unlocking are tabs on the File Workbench rather than separate tools, and the workbench has its own place in the sidebar, so the guides say so.

There is a new guide for Attorney License Lookup: which register answers for which state, why you read it live rather than taking Magna Carta's word for it, and the two states that publish theirs without encryption.

- The files area of a matter has had another pass.

Right-click a folder and Colour and Icon are now two separate choices, each opening its own small panel. The colours run in rainbow order and include pink, and the swatches are squares.

You can drag the inner edge of either side panel to make it wider or narrower, and double-click that edge to put it back. Setting a document type is now a small dropdown next to the field instead of a window that covers the screen.

File Analysis leads with how many issues are serious, how many are worth checking and how many are tidy-up. Any issue you have looked at and judged harmless can be ignored — it moves out of the list, and you can review what you have ignored and put any of it back. The whole list can be copied or downloaded, and so can a single scanner finding.

Deleted Files now looks and behaves like the rest of the files area: the same columns, sortable by when something was deleted and by whom, with the same right-click menu and multiple selection.

- **The money screens read like every other screen.** Time, Fees, Costs and Billing open on everything the firm has recorded, newest first, and you narrow them the way you narrow any list: from a column's own heading. Filter Date to a span, Status to drafts, Billable to what the client is charged for, and the filter holds across the whole record rather than only the rows already on screen. The dropdowns above the table and the line of text under the title are gone, and each screen's search reads the whole record: a word in a description, a matter's name or number, a timekeeper or payee, an invoice number or a client.

**Billing has New Bill.** Choose the matter, and the draft opens on that matter's own Billing section, where the work it claims lives.

**Messaging has no tabs.** Everything, the queue, what is filed and what was set aside are choices on the Matter column's filter, and the number of calls waiting to be filed stays on the counts strip under the table.

- **Time, Fees, Costs, Billing and Trust now look and work the same.** Each opens as one surface that runs to the edges of the screen, the way Files does: a row at the top names the money section you are on and lets you step to the other four in one click, the table starts directly under it, and the counts and totals sit on the bottom edge. Clearing filters, choosing comfortable or compact rows, and switching between the edge-to-edge and the framed table are on that top row, and the choice you make applies to every money section at once.

**Trust has a screen.** A matter's Trust section shows the ledger it will hold: every deposit, disbursement and transfer between the client's matters, with the balance, the amount under hold and what is available. It is empty for now and says why: the firm's trust accounts cannot be listed yet, so nothing can be read into it or recorded from it.

- When a document is slow to open, the screen now says which step it is on. If it stops, it says where, with the details support needs.
- **While a document opens, the panel now says how long each stage itself took**, so the slow one is the one with the big number, and **Show details** opens a log of what actually happened, in order: the editor's container being asked for, running and answering; the editor asking for the document's details and contents and what it was told; the page loading and the document appearing. The stages have plainer names: Opening your session, Starting the editor, Loading the editor, Reading the document's details, Fetching the document, Laying out the document.
- **Opening a document now tells you what is happening while you wait.** Instead of a list of steps that tick off, the panel reads like a log: each stage appears as it finishes, with the moment it did, and the stage under way says what it is doing and why it takes the time it takes. A bar fills over the half minute an open usually takes, and says so; past that it tells you the open is running long. Retry is offered only after forty-five seconds, since an open past the usual time is far more often about to finish than stuck. **Show details** opens the full sequence with its timings, and the details appear on their own if the open stops. The editor also runs on a larger machine now, so typing should feel quicker.
- **The favourite star is just a star.** Adding a screen to your favourites fills the star gold; nothing boxes it in.

**Settings folds.** My Settings, Firm Settings and Platform each fold on their heading, and so does every group inside them, the same way the left sidebar's groups fold. What you fold stays folded on this browser; the section you are reading is never hidden from you. Every settings page now scrolls in one place.

**The Directory searches the table you are looking at.** Typing narrows the directory table itself, with every column, sort and filter you had set still in place, in the firm's own best-match order. Matters that match are listed too, marked Matter, and open the matter. When the firm holds more matches than are shown, the line under the table says so.

**The calendar fits a smaller screen.** One scrollbar under the controls, a month that fills the height it has, and the controls in one line over the grid.

**Search says Search.** The search field on every screen reads the one word, since the screen is already named beside it.

**The document editor opens with its tabs.** Font and paragraph controls are on the Home tab at the top, where the compact toolbar kept them behind a menu. The editor's View menu still switches modes, and a mode chosen there is remembered by your browser.

**One panel at a time in the top bar.** Opening Uploads closes Downloads, and so on; the account menu opens on a click, never on hover, and now shows your name and your firm.

**Folders stay above files.** However you sort the file manager, folders sort among themselves at the top and files among themselves beneath.

- **Everything answers faster.** Moving between screens — and into a matter — no longer waits on the
  platform re-checking your sign-in from scratch on every single request: your session is verified
  once and then trusted for a few minutes at a time, so pages start with the work instead of the
  paperwork. Permissions and membership are still checked live on every request.
- **Export timestamps read in your own time.** Every downloaded report now shows the date and the
  time on their own lines, in your computer's clock with the time zone named beside it, so there is
  never a question of whose afternoon a snapshot belongs to.
- **A matter's status is changed from one control, in a panel that says what each step requires.** The status badge at the top left of a matter states the status and opens the matter's status window; beside the status there, one control reads **Change Status**.

It opens a panel listing the steps the matter can take from where it stands, each with one line saying where it stands: nothing in its way, a requirement not met, or a permission this account does not hold. Choose one and the panel states what it would do to the record and lists everything it requires, already answered by the firm's own rules, and the button at the foot reads that step's own verb. A hold asks for its reason there. A step you may not take is shown refused with the reason rather than hidden.

The checks moved with the change. What closing requires, what the firm's intake procedure still wants and the hold's reason are read where the decision is taken; the matter's number, its engagement and where the firm keeps its paper file stay in the window that reads the record, because they are true whatever the status is.

- **A register shows its shape before it holds anything.** Open Downloads before you have exported
  anything, or Uploads before you have sent a file, and the table is there — its column headings over
  one line saying it is empty — rather than a sentence on a blank page. A search that matches nothing
  says so in the same row, so the columns never disappear under you. The same is true of a record's
  names and relationships, a matter's deadlines and events, and a file's versions and checks.
- **The sidebar is regrouped, and every tool is one press away.**

The left sidebar used to carry a long Workspace list that ran from Home to Custodian. It is five
groups now, each answering one question: **Favorites**, your own shortcuts; **My Desk**, what is on
your plate — your day, your alerts, your tasks, your diary, Magnus; **Workspace**, the firm's work and
everything hanging off a matter; **Money**; **Firm**; and **Tools**.

**There is no Tools page any more, and no tool hidden behind one.** Every tool has its own address
and its own row: the WHOIS lookup, the safe website viewer, the network speed test, the
attorney-license lookup, shipping and postage, the property and business lookups, and the File
Workbench. They are folded into four groups you can open and close — **Records**, **Internet**,
**Mailing** and **Files** — and each group's tools read alphabetically. Firm Usage has moved out of
Tools and into **Firm**, beside Reports, which is where reading your own firm's numbers belongs.

**Any page can now be a favorite.** The star in a screen's header saves that page to the top of your
sidebar — a matter you are in every day, one tool out of nine, a client's record, a section inside a
matter. Favorites sit above everything and can be dragged into the order you want. The Customize
control that decides which of the built-in rows appear now uses an eye rather than a star, so the two
no longer wear the same mark.

Also fixed: dragging a row to reorder it no longer stutters, the rows show a grip so it is clear they
can be moved, and a "Soon" mark beside a long name is no longer cut off.

- **The tools are in the sidebar now.** Shipping and postage, the WHOIS lookup, the safe website viewer, the speed test and the rest each have their own row, so a tool is one click from wherever you are — and it opens across the full screen instead of sharing it with a list of the tools you are not using. "All Tools" is still there for browsing what each one does. The sidebar's Workspace, Money, Firm and Tools headings can be folded away to shorten the list, and it remembers which ones you folded.
- **Downloads and Uploads moved to the bottom of the sidebar.**

Both are about what the application is doing rather than about a matter, and they often run at the
same time, so they now sit in the row at the foot of the sidebar: Settings and the Customize control
at its near end, Downloads and Uploads at its far end. Uploads no longer has to be added from
Customize to reach it, and neither can be hidden by accident.

The download and upload buttons in the top bar are unchanged. Those stay what they were — a quick
look at what has just happened, with the acts you usually want — and the icons at the foot of the
sidebar open the full pages behind them.

- **Your uploads are remembered after you close the tab.** The Uploads screen keeps a record of each batch you have sent — which matter it went to, which folder it landed in, and every file in it — and any file that landed can be downloaded again straight from there. Search reads the file names, so a file you sent last week is one query away. Hovering the upload button at the top of the screen now tells you what it is, and both transfer screens say "No Uploads" and "No Downloads" plainly when there is nothing in them.
- **The Upload panel keeps its size, and tells you more.** The panel opens at one height and stays
  there: opening Advanced Settings, adding a folder, or unfolding one never moves what you were
  looking at. The left side is two tabs, Location and Advanced Settings. Each file on the right says
  whether it is ready to go: Reading while it is read, Ready once it is, Held when your firm already
  has a file with exactly those bytes (nothing is sent for it), or Not read if it could not be read.
  Add is one button, and its menu offers File and Folder by name. If a file fails to upload, its row
  and the uploads tray say what went wrong, not only that something did. The setting that asked
  whether to send files your firm already holds is gone: such a file is never sent twice, and deleting
  one copy never removes the stored bytes while another file, even a deleted one, still holds them.
- **Firm Usage is tighter, and the report leaves with you.** The page is now just the tables, and
  **Download Report** saves everything on it as a dated plain-text file you can keep or paste into an
  email. A display bug that gave tall pages a second scrollbar and a blank band beneath the app is
  fixed everywhere.
- **The version panel now colours the API and the page it serves instead of explaining them in a
  sentence, and it stops jumping around while it loads.** Open the chip in the top corner: the two
  workers that serve your session carry a small badge — green when they match, amber when the page is
  the one running behind, and a plain grey label for any other difference, since the two are allowed
  to deploy at different times. The "checking" line under the panel's title also no longer causes the
  panel to grow or shrink as it fills in.
- The version overlay (the small chip at the top right) now lists every part of the platform, each
  under the name it is deployed as, and never leaves one out: a part that is not deployed or not
  answering says so plainly instead of disappearing from the list. Your own page gets its own line,
  "This page", separate from the deployment list. Magna Carta also now notices when a newer version
  has shipped while you have the app open: the chip shows a small amber dot, and opening it offers an
  Update Available notice with a Reload button. Pressing the overlay's refresh control asks every part
  again right then, so the "checked … ago" line starts over.
- **The version overlay is shorter, and its controls sit together.** The panel used to open with a "This page" line that repeated what `magna-carta-web` was already reporting a row below; that line now appears only when nothing else can answer — before you sign in, when the read fails, or when that worker itself is silent.

The rest of the fleet folds away behind a caret beside **Workers**, and the overlay remembers whether you left it open or shut. If any of the folded workers came back without a version, the shut heading says how many, so folding the list can never hide a fault.

When a newer version has shipped, an amber reload symbol appears at the top of the overlay next to the refresh control, and the line telling you how fresh the reading is has moved under the heading so it no longer nudges the buttons as the clock ticks. Clicking a version to copy it now darkens it for a moment instead of growing a tick beside it.

- **The viewer now reads as one window.** The captured site and its facts sit in a single frame, and
  the facts lead with an Overview: the final status, content type, server, how many redirects and
  outbound links, when the capture was taken and how long it took. Anything clickable looks like a
  link. You can copy the landed address, download the screenshot as an image, and open it full
  screen. While a capture runs, the viewer shows the address being opened and the seconds elapsing.
  And a Registration tab shows who registered the captured site's domain, right there in the viewer.
- Opening a document shows one steady panel that does not jump around, and there is a Matter button in the editor to go back. Co-authors see each other's names.
- **The way back from a document is now the first button on the editor's bar, showing the arrow and the matter's number.** Its icon matches the editor's own, in the light and the dark theme alike. A matter that has no number yet reads "Matter".
- **The File Workbench has its own place in the sidebar now, under Firm.** It used to be one row inside Tools, four clicks in, which was the wrong way round: the file utilities listed there are the workbench's own tabs. Since the way you start is by dropping a file on it, it needed to be one reach away from wherever you already are.

You can move it or hide it like any other sidebar row, and Tools still lists it alongside the file utilities it runs.

- **The version panel now says what each "not reporting" line actually means.** A service the
  deployment does not include, a service that failed to answer, and a service running a build made
  before it could report its version now read differently instead of all looking like a fault.
- **Tools and Reports are one screen now, and both can be searched.**

Finding the metadata scrubber among twenty tools used to mean reading every heading. Both pages now carry the same search: the magnifying glass at the top right opens a field, the page narrows as you type, headings with nothing left under them drop out, and the count inside the field says how much of the whole you are looking at — "11 of 20". A word matches anywhere in an entry's name, the line describing it, the heading it sits under, or, for a report, the permission it runs under; typing a second word always narrows further. Some tools answer to words they never display, so "bandwidth" reaches the network speed test and "registrant" reaches the WHOIS lookup.

Reports also gains the card and list views Tools already had, and each page remembers your choice separately. A search that matches nothing says so instead of leaving the page blank.

- **Tools and Reports now show the whole list beside whatever you have open.** Every tool, grouped by subject, stands in a column on the left of the Tools area, and every report, grouped by family, on the left of Reports; the one you are on is marked, and one click moves to another without going back to the index first. The index itself, with its search and its two views, is what you see on arriving. A tool or report marked Soon is listed in the column, greyed, so you can see what is coming.
- **Uploading asks one question fewer, and starts working before you press Upload.**

**Add is one press.** It used to open a menu before it did anything; now it opens the file picker.
Folders are still their own ask — no browser will put files and folders in one picker — but the
arrow beside Add reaches it, and dragging any mix of files and folders onto the panel needs neither.

**A folder no longer makes the browser ask a second time.** Choosing a folder used to raise Chrome's
own "Upload N files to this site?" over the top of the panel, about a choice you had just made.

**A document type is set per file, not per batch.** One type for a whole upload is wrong about every
real folder — discovery holds correspondence, pleadings and exhibits together. Select rows, set the
type, and one upload files as many kinds as it needs to.

**"On Arrival" is now Advanced Settings, and it is folded shut.** Inside it: how a file is dated, and
whether the firm is asked if it already holds the bytes.

**Files are read while they wait their turn.** Each file is read so the firm can say "we already hold
this" before a byte moves, and that read now starts the moment you choose the file rather than when
the transfer reaches it. On a large batch most of the answers are in before you press Upload.

**The progress bar holds still.** The line beside it says how much has gone, how fast, and how long
is left, and every one of those figures changes length as the transfer runs — which resized the bar
several times a second. Its room is reserved now, filled or not.

**An upload that cannot reach storage says so.** Files go from your browser straight to your firm's
storage rather than through the rest of the application, so a refusal there reads as silence. It
said "nothing answered", which sent people to look at their own connection; it now says that it is
the storage that did not answer, that nothing was saved, and who puts it right.

- **The WHOIS lookup now rides out registry hiccups for you.** When a registry is rate-limiting or
  briefly away, the lookup retries automatically and shows you each attempt as it happens; you only
  see a failure once several attempts have genuinely not gotten through. **The Safe Website Viewer
  now works like a small browser.** The address bar sits on the viewer itself: type or paste a link,
  press Load Website, and the captured site fills the frame below, with the site's facts in boxed
  tabs beside it. If the link lands somewhere else, the real destination appears right under the
  address you entered. Back, forward, and refresh walk your capture history, clicking an outbound
  link captures that page next, and the address copies with one click. A Live view toggle shows
  where interactive viewing will arrive; it is not available yet and says so.
- **Empty places now show their shape.** A file's Hashes tab lists every algorithm before a digest is
  computed, with the reason beneath the list; a bill's Delivery tab shows the delivery record's frame
  before a delivery is recorded (and says why a draft has none); every history rail stands with its
  marker where the first event will go; the speed test's server facts and sample table are present
  before the measurement answers. What a screen is waiting on is said inside the list or rail it
  belongs to, where the values will land, rather than in a paragraph beside it.

### Removed

- **Searching the file tools now takes you to the File Workbench itself, instead of to ten separate entries that all led to the same place.** Convert, hash, scrub metadata, unlock, verify a type, repair, read an email, recognize text and scan for malware are things you do to a file once you have brought it to the workbench, not nine different screens to choose between first.

Searching still works the way it did: "ocr", "scrub metadata", "malware", "checksum" and the rest all reach the workbench.

### Fixed

- **Fewer "Try again" moments, and matters open faster.** Occasionally a screen would refuse to load
  with "The Docket Could Not Be Read" and an Error ID, then work on the very next try — that
  momentary fault is now retried behind the scenes before you ever see it. Opening a matter also got
  quicker: the page starts loading the instant your pointer settles on the link, not after the click.
- **The last of the white flash is gone.** Opening the app, or moving between your workspace and the account and sign-in screens, no longer shows a bright frame before the screen appears — including the one on a cold load, which was the longest of them. Screens now come up on the surface colour you were already looking at, in whichever theme you use.
- **A table's date filter can be set from its calendar, and a text column's filter lists the values to choose from.**

Opening the calendar on a Date filter closed the filter with it, so the dates disappeared the moment they were reached for and could only be typed. The calendar now opens inside the column's menu and stays there until a day is picked.

A text column — the changelog's From, To and File or Folder, a file's Name in every view, and every other text column on every table — used to offer a box that matched whatever was typed, which is a search, not a filter. It now lists every value the column holds, each with a checkbox and a count, so there is a baseline to choose from; the field above the list narrows it, and the one select control acts on what is listed, so a long list is narrowed to the values that match a word and taken in one press. Columns of prose, such as a time entry's description, keep the box that matches text.

- **A conflicts check now tells you who each candidate is.**

The list of candidates a check surfaced showed a record handle where the party's name belongs, and
you had to open each one to find out who it was. Every row now names the person or organization it
matched, as the Directory holds them today.

Where a name cannot be shown, the row says which of the two reasons applies rather than sitting
blank: the record was merged into another after the check ran, or the Directory holds it and nobody
has named it. A candidate is never shown as having no party — that is the one thing a conflicts hit
always has.

**The printed conflicts report improves most.** It could previously only name a party somebody had
opened on screen, so every other candidate printed as a raw handle on the document a firm hands a
court. It now names them all.

- **The date you are looking at is legible when it is also today.** Picking today in a calendar used to blank the date out entirely — the number was drawn in the highlight's own colour with the highlight missing. Today now wears a thin ring and a bolder number, so it stays visible whether or not it is the day you have chosen.

**The small calendar shows where the month begins.** Days that belong to the month before or after are now shaded as a block rather than merely printed in a lighter grey.

- **Rename your firm and it takes effect immediately.** Changing your firm's name is reflected right
  away everywhere it appears, including on file-integrity receipts — previously the old name could
  linger for up to a minute after the change.
- A guest link now tells the person holding it what happened to it: a link past its time says it
  has expired, a withdrawn link says the firm withdrew it, and a link used too many times says so,
  each with the same remedy, which is to ask the firm for a new one. Somebody who opens a link while
  another person is already in the meeting on it goes to the waiting room under the name they typed,
  so the host decides who comes in. A guest whose link was withdrawn by mistake can be invited again.
- **Handing a meeting over keeps you running it too.** Passing the room to a colleague now leaves you
  as a co-host, so you keep the mute, the spotlight and the door instead of losing them the moment you
  hand over.

**You can stop being a co-host yourself.** Step down from your own grant without having to ask the
person who gave it to you.

**A meeting whose host has gone can always be taken over.** If two co-hosts were in the room and the
host had left, neither of them could take the room; either of them can now.

**Shutting the door works at the moment you press it.** Locking a room, or turning the waiting room
on, now takes effect for somebody arriving in that same instant — which is exactly when a host
reaches for it.

- **Four dropdowns crashed the screen when they had nothing to offer.**

Picking a matter on the Messaging screen returned an error report rather than a list. The same one-line fault was in the matter picker, the time-zone picker, the calendar's participant picker and the time record window's document picker. All four are fixed.

- **A meeting is steadier when one person's browser misbehaves.** The room now paces what a single
  connection may send it, so a tab that goes haywire — or a modified client — is slowed down instead of
  slowing down everybody else's video. Nobody is disconnected for it, and a browser doing the ordinary
  thing will never notice.

**Nobody can take over your meeting from outside it.** Taking over a meeting whose host has
disappeared is still possible, and it still needs no one's permission — but only from somebody who
is actually in the meeting, or waiting at its door. Somebody who never joined is told to join first.

**Coming back after a dropped connection no longer restores a role that was taken away.** If your
co-host role was withdrawn while you were reconnecting, you come back without it, the way the record
says.

- **Registering now asks for your password, and the account you confirm is one you can sign in to straight away.**

Before this, creating an account sent a second email carrying a link that set the password. If that email did not arrive, the account existed and there was no way into it — sign-in simply refused, with nothing on screen explaining why.

You now choose the password on the registration form. It is scrambled the moment you send it, never stored or written to a log in readable form, and it is attached to your account at the moment the account is created — when you open the link in the confirmation email, which is still how we know the address is yours. One email instead of two, and the screen at the end says your account is ready and offers Sign In.

Password reset goes back to meaning what it says: replacing a password you already have.

If you were invited to a firm, redeeming your invitation still sends you a link to set your password. That link is deliberate — the code, surname and date of birth you type are not proof that the mailbox is yours, and the emailed link is.

**If a confirmation email cannot be sent, we now say so.** You get a message telling you nothing was lost and to try again in a moment — with an ID to quote to support if it keeps happening — instead of being sent to an inbox where nothing would ever arrive.

- **Fixed: a report you downloaded could go missing from Downloads.** Certain reports were rejected
  when the platform tried to keep a copy, and nothing told you it had happened — the download worked,
  and the item simply never appeared. Those reports are kept correctly now, and in the rare case one
  still cannot be, the page says so and gives you an Error ID to quote.
- **Naming a new folder no longer takes three clicks.** Make a folder and the cursor is already in its
  name, with the stand-in name selected, so you can type over it. Renaming from the list works the
  same way, and the row no longer grows taller while the field is open.

**Pinning a document no longer nudges the list.** The space for the pin is always there, so pinning
lights the mark and moves nothing.

- **A failed page capture now says what actually went wrong.** When the Safe Website Viewer could not
  capture a page, it always gave the same answer — that the service was busy and to try again in a
  moment — even when trying again could never work. It now tells the two apart: a genuine momentary
  outage still asks you to retry, while a problem that needs someone to fix something gives you an
  Error ID to quote to support instead of sending you back to a button that cannot succeed.
- Joining a large meeting no longer queues behind everybody else who is joining at the same moment.
- Saving in the browser editor works, and co-editing the same document works. The editor's welcome dialog no longer appears every time a document is opened.
- **An event that runs for several days now shows on every one of them.** A three-day trial, a week of office closure, a two-day deposition — each used to appear only on the day it started, so the days after it read as free when they were not.

On the **month** they paint across the days they cover, as they did before. On the **week** and the **day**, where the hours run down the side, each day shows the part of the event that falls on it: the first day from its start time to midnight, a day in the middle filled, and the last day from midnight to when it ends. That is what "in court until Wednesday afternoon" looks like on a calendar.

**All-day events sit in a band above the hours**, on both the week and the day, rather than at midnight — a filing has no hour, and parking it at the top of the column implied one.

- **A new firm no longer opens into a workspace that refuses every screen, and the wait to get there now names its steps.**

Creating a firm is several pieces of work — a record, encrypted document storage, an encryption key, the workspace itself, and adding you to it as its owner — and the last of them lands after the firm is already active. The app used to go in the moment the firm appeared, which is why a first sign-in could arrive at a workspace where every screen answered as though a permission were missing. It was a wait, not a permission, and nothing said so.

The joining screen now waits for that last step too, and shows which one it is on: each step is named, finished, in progress, or still to come. A build taking longer than usual says so, and work that has stopped and will not retry says that as well, instead of looking busy forever.

- A screen no longer shows the wrong matter's information when you move between records quickly — an answer that arrives after you have moved on is discarded instead of being displayed under the record you are now looking at. Retrying a save that failed without a clear answer no longer risks recording it twice. And asking twice for the same large download now builds it once rather than starting a second copy.
- An edit that loses a race now says so instead of reporting success. Changing a fee or cost entry that somebody else invoices at the same moment is refused — the entry and its invoice were always protected, but the answer used to report the change as applied, and you only saw otherwise on a reload. The refusal is the same one you get for editing an entry that has already been billed, and nothing is recorded against the entry for a change that did not happen.
- Word-processing documents now open all the way. The editor's own frame was arriving without the connection that carries the document, so it drew an empty toolbar and stopped.
- **Files now say who created them.** The Created By column in the file list, and a Created By line in
  a file's details, show the member who uploaded the file. A file uploaded before this change shows
  its uploader too; a file whose uploader has since left the firm shows no name rather than a wrong one.
- **Uploading works again, and it works while you do something else.** Choose **Upload Files** and
  the panel opens with the destination on the left — the matter (any matter, not only the one you are
  on), the folder, whether each file keeps its own date or takes today's, and a document type for the
  batch — and your files on the right, in the folders they came from. **Add** offers files or a whole
  folder; you can also drop them anywhere on the right. Filter the list from its column headers.
  Press **Upload** and the panel shows each file's progress; close it whenever you like, because the
  upload keeps going. The **upload button in the top bar** shows what is still moving, what finished
  and what failed, with **Retry Failed** and **Open folder** beside each batch. If a file does not
  upload, it no longer leaves an empty entry in the matter. Each file shows how far it has got, files
  of any size upload (a large one goes in pieces behind the scenes), and **Cancel Upload** stops a
  batch: what has landed stays, and the rest can be sent later with **Send the Rest**. A file the
  matter already holds is not sent again, and one your firm holds on another matter is copied across
  without an upload; the tally reads the speed and about how long is left; and **Uploads** in the
  sidebar shows every upload in full, the way Downloads does.
- **Uploads are checked promptly again.** A file you upload no longer sits at "Checking the file" for
  minutes while the safety scanner wakes up: the scanner is kept ready, and a check that does have to
  wait retries patiently instead of giving up. If a check is still running when the upload dialog
  stops waiting, the dialog now says so — the file appears on the matter as soon as the check finishes.
- **The viewer stops blaming your address during updates.** When the app is mid-update, a capture
  now says so and suggests a refresh instead of claiming the address cannot be viewed — and in most
  cases it simply completes the old way, without the progress narration. Typing a bare word like
  "google" now tells you at the field to enter a full address. The download menu shows each format
  with its file symbol, and the Static/Live switch reads as one control with the active side filled.
- More edits that lose a race now say so rather than appearing to work. Claiming a discovery document, deciding a destruction request, moving a folder, putting a matter on hold, freezing a trust reconciliation and editing a draft time entry all now refuse when the record moved underneath the request, instead of reporting success and leaving things as they were. Nothing is recorded against a record for a change that did not happen.
- **Changing where a setting is held now moves the room booking with it.** Recording an event in one of your conference rooms has held that room for a while. Editing it afterwards did not: move a deposition from the Boardroom to Conference Room B and the Boardroom stayed booked while Conference Room B stayed free, so both room calendars were wrong until somebody noticed.

Now the booking follows the Location field. Change the room and the old one is released and the new one held; change the location to a courthouse and the room is released; change one courthouse for another and nothing moves. If the new room cannot be held — somebody else has it and the booking is refused — your change to the event is still saved and the window tells you the room was not held, rather than quietly losing one or the other.

**Book a Room has gone from the buttons along the top of an event.** Choosing the room in Location is how a room is held, and a second button for the same thing was the confusion. It is still on the **Rooms** tab, where you can see what the event has booked, hold a second room, or book a car.

- **A template with Word's old fill-in-the-blank fields now tells you those blanks will not be filled
  in.** Registering one lists each field, the prompt its author wrote, and the words the document will
  print where it sits — and every document you build from that template reports the same fields and is
  marked as needing review before it is filed.

Before this, such a template registered without comment and said it carried nothing to fill in. The
document then came out with the form's own instructions in it, like "Click here to enter caption",
and nothing had warned you.

These fields cannot be filled in automatically, and the system will not guess what one was meant to
mean — the only name Word keeps for such a field is something like "Text1". To bind one, replace it
in Word with a `{{field}}` naming the merge field it should have been.

- **Editing a document in the browser now works.** Opening a document in the editor, taking a copy away
  to work on offline, checking it back in, resolving a conflict between two copies, and releasing a
  lock somebody else left behind were all built and all refused — every member of every firm was told
  they did not have permission, whatever their role. They now sit where the rest of your document work
  already does.

Anyone who can upload a document can also edit one and take it offline: that is the Owner/Admin,
Attorney and Paralegal seats. Deciding which of two conflicting copies becomes the real one is
narrower — Owner/Admin and Attorney — because it can set aside somebody else's work. Breaking another
member's lock is narrower still and sits with Owner/Admin alone; a lock nobody is using is released
automatically overnight, so nobody has to wait for an administrator.

**Four groups of tools appear on the Tools page that were never visible to anybody.** Property
listings, county property records, business-entity lookups and attorney-licence lookups are ordinary
public-record links, so every seat sees them, including Read-only. Shipping and postage appears for
Owner/Admin, matching who can already connect the firm's postage account. Several of these still read
"Soon" until their own page is built — what changed is that they are now on the page at all.

Nothing was taken away from anyone: every change here is an addition, and it reaches firms already
using Magna Carta as well as new ones.

- **WHOIS lookups stop telling you a registered domain has no record.** When a registry is briefly
  rate-limiting or unavailable, the lookup now says exactly that and invites a retry — before, it
  wrongly reported that no registration record existed. Looking up an IP address now also names the
  organization the address block is registered to. The Safe Website Viewer gets a cleaner shape: the
  captured site appears in a browser-style frame on the left, which stays calm until the isolated
  browser has fully finished rendering — you never see a half-loaded suspect page — and everything
  the capture learned sits in tabs beside it: the redirect trail, the page's text, its outbound
  links, and the server's response headers.
- **Tasks, Time and Magnus now line up with every other screen.** All three sat further from the edge
  of the window than the rest of the product; they no longer do.

**Searching your tasks works the way it does everywhere else.** The task list's search was its own
one-off: a box that sat open on the row whether or not you were using it, and that behaved slightly
differently from the search on Matters, Intake or the Custody register. It is now the same control as
the rest of the product — it rests as a magnifying glass, opens with your cursor already in it, marks
itself while a search is live, and clears with the X or the Escape key.

- **Help › About inside the editor now shows the Magna Carta build as separate lines**, each labelled, and the build number is a link to the change it names.
- **The way back from a document now shows the matter's number beside the arrow**, cut short with an ellipsis when it is long. Rest the pointer on the button to see the whole number.
- **The calendar opens without waiting for your whole matter list.** It used to read every matter the firm had ever opened before it drew anything, so the longer a firm had been using the product the longer its calendar took to appear — even though the only thing that list was needed for was printing a matter number on each entry.

Now the calendar appears as soon as its own entries are ready. The matter numbers fill themselves in a moment later, without the calendar asking for anything twice.

**And if you open New Event straight away**, the matter list may still be arriving. The picker now says "Reading the firm's matters" while it is, instead of telling you there are none.

- **No stray scrollbar under a platform notice.** When the platform is in trouble and the notice shows, Settings, the Calendar and Magnus fit beneath it instead of scrolling the whole page by the notice's height.
- **A page that will not load now says so.** The Safe Website Viewer could not capture ordinary
  websites — anything with live updates on it would time out, and the message blamed our service for
  being busy. Captures work now. If a page still will not load, the viewer tries again in a simpler
  way first, and tells you plainly that the page did not finish loading rather than asking you to
  report a fault.
- **Captures now show the finished page, all of it.** The isolated browser waits until the site has
  actually loaded before taking its screenshot, and the screenshot covers the whole page, not just
  the first screen. While it works, the viewer tells you what is really happening: where the link
  landed and how many redirects it took, while the picture is still rendering. Checking who
  registered a site now works for any address on it — pasting a link to a page inside a site finds
  the site's own registration record. The viewer's frame is tidier: one continuous top bar, the
  different-site callout lives with the facts on the right, and the WHOIS page shows its result area
  before you search.
- **Conflicts checking is now in your sidebar, and every matter has a Conflicts tab.**

The conflicts screens were finished but the sidebar still listed Conflicts Check as coming soon, so
unless you knew the web address you could not get to them. The row is live now: running a check,
reading every check your firm has run, and opening any one of them to see what it searched, what it
turned up, and who answered each result.

Each matter also has its own **Conflicts** tab, next to Intake, holding that matter's record — when
it was last checked, anything nobody has answered yet, whether your firm has widened what a check
must cover since, and a way to run another. It replaces a page that lived outside the matter and was
awkward to find; old links still work.

Two smaller things that made the record hard to reach are fixed. A conflicts check on a matter's
activity history now opens the check it refers to, instead of only saying one happened. And the
intake checklist keeps its link to the conflicts record after the step is marked done — it used to
disappear at exactly the point the record became the thing you would want to produce.

- **Switching between the tabs inside a matter no longer breaks the screen.**

Moving from Files to Parties — or between any two sections — could stop the page dead. The New button at the top of a matter checks that it belongs to the section you are actually looking at, and for a fraction of a second during every tab change it belonged to the one you had just left. That moment is normal, and it is now treated as normal: the button simply waits, greyed, until the new section is ready, which is what it already did while a section was loading.

- **Renaming from the details panel now opens the field in the panel.** Press the name at the top of the panel, type, and press Enter to keep it or Escape to leave it as it was; clicking away keeps it. It used to put the cursor on the row in the list instead, which is no help when that row has scrolled away. If the name is already taken, the field stays open with what you typed and the reason beneath it, and the document keeps the name it had.

**A document's Safety tab now shows what its checks ran under.** Beneath the history of checks, the tab states the three parts of the engine the firm uses and the firm's four file-safety settings, and says plainly which of them is recorded against each check and which is only true of today. A request for a fresh check that could not be sent to the engine now reads "Not queued" and says why, instead of looking like a check on its way.

- **The Directory now opens on your firm's records instead of on an instruction to search.**

There are two shapes on the screen and they are different things. The listing is your whole directory in name order, walked a page at a time, and it says how many records the firm holds. A search answer is in the firm's own relevance order and says when the firm holds more matches than are shown.

People and organizations sit in one listing, because the directory is one book and somebody looking for a name does not know in advance which the firm filed them under. Kind is a column and a filter rather than a second screen. A record folded into another is not listed: its names still find it and still lead to the surviving record, but listing it beside that record would show one client as two.

- **Documents opens again.** Every visit to the firm's template library met an error screen instead of the catalogue. The button that registers a new template had a label one character too wide for it, which stopped the whole page from drawing rather than just the button; the control is slightly wider now and the page loads normally.
- Word-processing documents open in the browser editor again. The screen now shows that a document is opening for as long as it takes — a document nobody has opened recently takes a moment longer while its editor starts — and says so plainly, with a way to try again, if the editor does not come up.
- Word-processing documents open in the browser editor. The editor had been refusing the host that serves it the document; it trusts it now.
- **Scrolling a long folder on a matter's Files page now scrolls the list and nothing else.** The matter's title, its row of sections, the folder path and the counts strip along the bottom stay where they are however many documents are in the folder, so the screen reads as one screen at any length. The same fix reaches the four money sections, which are built the same way.

**Undo and redo cover the acts you actually perform on that screen.** Renaming, moving something between folders, pasting what you cut, deleting a file and pinning can each be taken back from the arrows at the bottom, and each one says which change it will reverse before you press it. Deleting a **folder** still cannot be undone: the screen says so at the time and points you at Deleted Files, where the documents that folder held can be brought back one at a time.

**In the left rail, the folder or view you are standing in is lit the same way whichever it is.** History, Deleted Files, Search Results and File Analysis were marked so faintly against the rail that the open one was hard to pick out beside a chosen folder.

**In the icon layout, a long file name no longer runs over the tiles beside it.** A name wraps onto a second and a third line and then ends in an ellipsis, and the whole name is there on the tile's hover. Pinning an item lights a pin without shifting anything around it.

**A document can be renamed from the details panel itself**, with the same refusal you get on a row when the name is already taken in that folder.

- **The path above a matter's files stays put, and Home is always one press away.** Opening a folder
  deep in a matter used to shift the whole row of controls above the list as a scrollbar appeared under
  the path, and shift it back on the way out; Home, at the head of the path, was the first thing to
  slide out of reach.

Home now sits beside the back, forward and up buttons, where it stays whatever folder you are in. A
path too long for its strip folds its middle away behind an ellipsis: the folder you are in, the one
it sits in, and the first folder under Home stay visible, and pressing the ellipsis lists the folders
it stands for so you can open any of them directly.

- **You can register a firm and sign in, end to end.** The confirmation email now contains a link you
  can click — with the typed code kept as a fallback — and the password email opens a real screen
  where you set your password. If something goes wrong on our side, the message now shows an Error ID
  you can quote to support.
- **The file list is the height it should be, and zooming it works.** Files in list view were separated by a band of empty space, with the name sitting low in each row while every other column was centred, and the last file in a list had no line under it. The zoom control changed almost nothing in list view; it now scales the list's text, its row heights and its icons across its whole range, the same way it already scaled the icon view.

The Location column is gone from a folder's own listing, where it only ever repeated the folder you were already in. It still appears in search results and in File Analysis, where files come from different folders. File Type is no longer lettered differently from every other column.

**Changing a matter's status is now one window with the steps on the left and what each one means on the right,** rather than a list that grew a section underneath when you chose from it.

**Two controls inside the matter's status window stopped moving the window when you use them.** Recording where the paper file is kept, and setting the matter's number, are fields that stand in their rows at rest — with the office chosen from a list you can also type into — instead of buttons that opened a form underneath and pushed everything down.

- **A new firm is ready to use as soon as it is built.** Setting up a firm made the workspace within seconds but could take several more minutes to finish adding you to it, and screens opened in between refused what you asked for. Both steps now finish together.
- **The prefix and suffix lists take a second choice.** They hold several on purpose — "III, Esq.",
  "M.D., Ph.D." — and once you had chosen one, no other could be picked: the list showed only the
  entry you already had, and the only way to reach another was to take the first back off. Both lists
  offer everything again after each choice.
- Reporting a problem from the version chip works again. The report used to appear for a moment and
  then vanish along with the panel behind it; it now stays open, with everything the panel was
  showing already attached.

A half-written report also survives being closed and reopened from anywhere — the profile menu, the
command menu and the version chip now open the same report rather than three separate ones.

For the people who run the platform, the version overlay carries one more link at the top: the
source the build on screen came from.

- **The search box now clears, closes, and takes you somewhere.**

A search you have typed into carries an **X** at its end. Pressing Escape always emptied the field,
but nothing on screen said so, so there was no way to clear it with the mouse alone.

**Clicking anywhere else now closes an empty search box.** It used to stay open behind whatever you
did next. A search with words still in it stays open, so a narrowed list always shows you why it is
narrowed.

**Pressing Enter opens the full results page**, and you can now open it before typing anything —
useful when you want the whole search surface rather than the quick panel. The panel itself opens as
soon as you click the search, so you can change where it looks before you start typing.

**Searching a matter now finds folders, not just files.** Looking for a folder by name used to come
back with nothing even though the folder was sitting in the matter. Folders now appear under Files
alongside matching documents, each labelled so you can tell a folder from a file of the same name.

**The search opens in two directions, and the full results page matches it.** The icon opens to the left into the field, which is for
writing the query, and downward into a panel, which is for aiming it — the scope, and whether
deleted records join the answer. The scope used to sit inside the field itself, where spelling out
"Everything on this matter" took most of the width the field had.

- **The Status link in the top bar works.** It opens the live service-status page. The sign-in screen
  also drops a line of boilerplate under the card, and the small links beside each field now show the
  hand cursor when you hover them.
- **Signing in works again after clearing your browser's cookies.** The sign-in, password-reset and invitation screens had begun failing to draw, with an error in the browser console, because a control they share with the signed-in app was missing a piece of setup that only the signed-in app provided.
- **Reopening a matter's status window now shows the current fee arrangement.** If somebody amended the
  agreement from another screen after you had opened this window once, reopening it used to keep
  showing the old terms until you reloaded the page. It reads the agreement afresh every time it opens.
- **Captures now include the images further down the page.** The isolated browser scrolls through
  the page once before taking its screenshot, so pictures that only load as you scroll are in the
  shot. And the viewer now fits your screen exactly: no more bottom edge hanging below the window,
  and the screenshot scrolls inside its frame.
- Word-processing documents open in the browser editor. The editor could reach everything it needed except the document itself; it reaches that now.
- **A template built with Word's content controls now tells you those blanks will not be filled in.**
  Registering one lists each control by the name its author gave it and the words the document will
  print where it sits — and every document you build from that template reports the same controls and
  is marked as needing review before it is filed.

Before this, such a template registered without comment and said it carried nothing to fill in. The
document then came out with the control's own prompt in it, like "Click here to enter text.", and
nothing had warned you.

A control you have filled in is left alone and says nothing, because what it holds is your own text.
Controls cannot be filled in automatically yet, and the system will not guess what one was meant to
mean from its name. To bind one, replace it in Word with a `{{field}}` naming the merge field it
should have been.

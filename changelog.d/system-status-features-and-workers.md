---
category: Changed
audience: public
---

**System Status shows each feature beside what it runs on.** The Features, Deployment and Workers tabs are one **Features and Workers** tab. The two workers every feature runs on head it with their builds and merges. Below them, a table lists each feature with the worker that does its work (its health, build and response time) and each outside service it calls. An outside service reads **Connected** where a free live check ran, **Key set** where it was not checked because calls are billed, or **Not set up**. Workers no feature uses are listed under **Other Workers**. On a narrow screen the table becomes one card per feature.

## Public

**See what each feature depends on in System Status.** Settings, System Status now lists every feature beside the services it needs, whether each one is working, and which version is running, all on one tab. Outside services such as Google Calendar or Telnyx say whether they connected, whether their key is set, or whether they still need setting up.

---
category: Added
audience: public
---

**The words inside files answer a search across matters that reaches few of them.** The
`file-contents` source declares an `acrossMatters` reading of a new kind, `file-contents`, with a
`prepare` step as it has inside a matter. Each matter's files are one index, so
`runKeywordSearchOverMatters` (`apps/api-worker/src/search/keyword-search.ts`) asks each matter's
own corpus apart and merges the answers, after `listMattersWithLiveSplits` has said which hold
anything indexed. The source answers where the search reaches 25 matters or fewer and is skipped as
`too-many-matters` past that; `GET /api/v1/search` gains that reason and `fewMattersLimit`. The
Search page lists a place its index could not answer for under Not Searched, with why. What that
many questions cost the engine is not measured, because the engine cannot run in a cloud session.

## Public

**The Search page looks inside files when you search a client's matters, your own, or a small
firm's.** Choose One Client or My Matters under Search In and a new place, Inside Files, finds
files by the words in them, names the pages, and quotes the sentence. It answers when the search
reaches 25 matters or fewer, and says so under Not Searched when there are more. Searching inside
files has to be turned on for the firm, in Settings under Search and Indexing.

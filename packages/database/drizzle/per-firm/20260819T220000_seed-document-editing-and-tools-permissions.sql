-- Nine registered permissions that no seed granted to any role, and therefore that no member of any
-- firm could hold. There is no escape hatch behind them: effectivePermissions
-- (packages/access-control/src/resolver.ts) is the union of the member's role rows and their
-- unexpired direct grants, with no wildcard and no owner bypass, and nothing in
-- packages/data-access writes `role_permission` or `direct_grant` — these seeds are the whole
-- supply. So a permission absent here is a capability the product refuses to everybody, forever,
-- with a correct-looking 403.
--
-- The rolePermission_ handles are minted once and committed as literals, 21 characters of the
-- identifier alphabet like every other seeded handle; the role_id values are the five default roles
-- from the baseline's member-rbac seed.

-- ---------------------------------------------------------------------------------------------
-- The co-editing surface. apps/api-worker/src/editing enforces four keys at the chokepoint, and none of
-- them was reachable: the editor launch, the offline checkout and its check-in, the divergent-copy
-- reconciliation, and the force-release of another member's lock all answered 403 to every member
-- of every firm.
--
-- documents:edit and documents:checkout go to the three content-writing seats — Owner/Admin,
-- Attorney, Paralegal — which is exactly where files:upload, files:organize and documents:assemble
-- already sit. Editing a document in the browser and taking it away to edit offline are the same
-- act through two doors; a member who may cut a new version by uploading one must be able to cut
-- one by typing. Billing and Read-only are excluded because Billing holds no content-writing key at
-- all and Read-only is that by name. check-in rides documents:checkout deliberately: a member who
-- may take the copy out must be able to bring it back, or the capability is a trap.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsEdit00000001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'documents:edit');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsEdit00000002', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'documents:edit');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsEdit00000003', 'role_917LCQyRKP50Z9bW89vXl', 'documents:edit');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsCheckout0001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'documents:checkout');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsCheckout0002', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'documents:checkout');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsCheckout0003', 'role_917LCQyRKP50Z9bW89vXl', 'documents:checkout');--> statement-breakpoint

-- documents:reconcile decides which of two divergent copies of the firm's document is the
-- authoritative one — it can set aside a colleague's offline work, or promote it over the version
-- everybody else has been reading. The conflicting copy is retained either way, so the decision is
-- recoverable, which is why this is not administrator-only; but it is a decision about the text of
-- record, which is the bracket files:delete and esign:seal already sit in. Owner/Admin and Attorney.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsReconcile001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'documents:reconcile');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsReconcile002', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'documents:reconcile');--> statement-breakpoint

-- documents:forceReleaseLock displaces a hold somebody else took — an exclusive lock, or the
-- stranded offline checkout of a member who has been deactivated. Owner/Admin and nothing else,
-- deliberately NOT alongside the editing keys: an override every editor also holds is not an
-- override, it is a second way to take the document. Nothing deadlocks behind the narrow seed —
-- the exclusive lock is opt-in and the idle-checkout sweep releases a stale hold on the daily cron
-- without anybody asking. Widening a seed later is a migration; narrowing one is a conversation
-- with every firm that had got used to the wider default.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_documentsForceRelease', 'role_Gw-zKO8hOHQuNv2bWokMp', 'documents:forceReleaseLock');--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- The five Tools catalogue manifests nothing granted. toolsByGroup (packages/tools/src/select.ts)
-- renders only the tools whose permission the member holds, so these five were invisible to
-- everybody and four whole subject groups — property, business-entities, people-licenses,
-- mailing-shipping — never appeared on the Tools page for any seat. Every tool added to the
-- catalogue after the baseline shipped with its own seed in the same commit; these five were
-- declared in the baseline against a Tools shell that did not exist yet, and the seeding never
-- followed the shell when it landed.
--
-- The four link libraries go to all five roles, the reach every other credential-less read-only
-- lookup already has (tools:whois, tools:safeBrowse, tools:fileIntegrity, tools:fileTypeVerifier,
-- tools:metadataScrubber, tools:aiTextDetection, tools:emailInspector). They open a public-record
-- website in a new tab: they read nothing of the firm's, hold no credential, and store nothing. A
-- link to a county assessor is not a privilege, and a Read-only seat asked to check whether an
-- opposing lawyer is in good standing should not need a role change to do it.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyListings1', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:propertyListings');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyListings2', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:propertyListings');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyListings3', 'role_917LCQyRKP50Z9bW89vXl', 'tools:propertyListings');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyListings4', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:propertyListings');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyListings5', 'role_WojF9F7kksBEftsmZGNhb', 'tools:propertyListings');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyRecords01', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:propertyRecords');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyRecords02', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:propertyRecords');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyRecords03', 'role_917LCQyRKP50Z9bW89vXl', 'tools:propertyRecords');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyRecords04', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:propertyRecords');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolPropertyRecords05', 'role_WojF9F7kksBEftsmZGNhb', 'tools:propertyRecords');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolBusinessLookup001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:businessLookup');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolBusinessLookup002', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:businessLookup');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolBusinessLookup003', 'role_917LCQyRKP50Z9bW89vXl', 'tools:businessLookup');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolBusinessLookup004', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:businessLookup');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolBusinessLookup005', 'role_WojF9F7kksBEftsmZGNhb', 'tools:businessLookup');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolAttorneyLicense01', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:attorneyLicense');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolAttorneyLicense02', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:attorneyLicense');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolAttorneyLicense03', 'role_917LCQyRKP50Z9bW89vXl', 'tools:attorneyLicense');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolAttorneyLicense04', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:attorneyLicense');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolAttorneyLicense05', 'role_WojF9F7kksBEftsmZGNhb', 'tools:attorneyLicense');--> statement-breakpoint

-- tools:shipping is the one entry here backed by a connected vendor account rather than a link, and
-- every operation behind it — rate, buy, track, refund — is gated on shipping:manage, which is
-- seeded to Owner/Admin alone. Matching the tile to the capability is the point: seeding it wider
-- would put a tool in four more seats' Tools page whose every button their role refuses.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_toolShipping000000001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:shipping');

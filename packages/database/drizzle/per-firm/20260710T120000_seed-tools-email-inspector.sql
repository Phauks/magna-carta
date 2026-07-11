-- Seed tools:emailInspector onto every default role. Reading .eml/.msg/mbox headers, participants,
-- attachments, and authenticity facts is an everyday safety utility any firm member may need without a
-- separate grant — the same broad reach as the other tools:* utilities. The rolePermission_ handles are
-- minted once and committed as literals; the role_id values are the default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_wN3fXjE8pQmZdRykbG5tv', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:emailInspector');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_LhK9cVoY72xTiWamF4uzs', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:emailInspector');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_bR5tQnH38jSuNe0dyLkA1', 'role_917LCQyRKP50Z9bW89vXl', 'tools:emailInspector');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_pD8mWzX41oKrCfa6nBt7Y', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:emailInspector');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_qT2vJfN95hUiSoc3mXe8Z', 'role_WojF9F7kksBEftsmZGNhb', 'tools:emailInspector');

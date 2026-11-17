-- Execute as an authorized owner/admin after verifying that this is still
-- the agent-risk app service principal shown in App Settings.
GRANT USE CATALOG ON CATALOG `workspace`
TO `a7caf316-08ef-4609-bf03-c491ec9bae58`;

GRANT USE SCHEMA ON SCHEMA `workspace`.`ifc_case_comp`
TO `a7caf316-08ef-4609-bf03-c491ec9bae58`;

GRANT SELECT ON TABLE `workspace`.`ifc_case_comp`.`external_news`
TO `a7caf316-08ef-4609-bf03-c491ec9bae58`;

GRANT SELECT ON TABLE `workspace`.`ifc_case_comp`.`industry_reports`
TO `a7caf316-08ef-4609-bf03-c491ec9bae58`;

GRANT SELECT ON TABLE `workspace`.`ifc_case_comp`.`regional_risk_reports`
TO `a7caf316-08ef-4609-bf03-c491ec9bae58`;

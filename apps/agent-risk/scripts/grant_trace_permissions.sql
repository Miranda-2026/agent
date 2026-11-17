-- Repair the exact missing trace-table access reported in the supplied log.
-- Run as an authorized catalog/schema/table owner or administrator.
-- This UUID is the agent-risk app service principal's client_id from the log,
-- not the interactive user. Verify it in agent-risk Settings before executing.

GRANT USE CATALOG ON CATALOG `workspace`
TO `a7caf316-08ef-4609-bf03-c491ec9bae58`;

GRANT USE SCHEMA ON SCHEMA `workspace`.`ifc_case_comp`
TO `a7caf316-08ef-4609-bf03-c491ec9bae58`;

GRANT SELECT, MODIFY
ON TABLE `workspace`.`ifc_case_comp`.`665854304075459_otel_spans`
TO `a7caf316-08ef-4609-bf03-c491ec9bae58`;

SHOW GRANTS ON TABLE `workspace`.`ifc_case_comp`.`665854304075459_otel_spans`;

-- Also inspect the experiment's actual trace location. If annotations/logs/
-- metrics tables are present, grant SELECT and MODIFY on those confirmed tables
-- as well. Do not grant broad access to the portfolio schema or recreate tables.

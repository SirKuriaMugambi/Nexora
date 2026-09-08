-- Staff document store: contracts, ID copies, certificates, appraisals and
-- other HR records, filed against the employee they belong to.
--
-- These are the most confidential records the company holds, so this
-- migration does three things, and the third matters most:
--
--   1. Links a document to an employee (employee_id) and records what kind
--      of HR document it is (staff_doc_type).
--   2. Restricts staff-linked rows in public.documents to finance_manager.
--   3. Restricts the FILES THEMSELVES in storage to finance_manager.
--
-- Point 3 is not redundant. Supabase Storage is reached by the browser
-- directly, not through this app, so proxy.ts cannot protect it — and the
-- previous bucket policy let ANY authenticated account read ANY file in
-- finops-documents, employee-portal accounts included. Without the storage
-- policy below, an employee who learned a file's path could download another
-- employee's contract regardless of what the table policy said.

-- ── 1. Schema ──────────────────────────────────────────────────────────────
ALTER TYPE public.doc_tag_type ADD VALUE IF NOT EXISTS 'staff record';

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS employee_id varchar REFERENCES public.employees(id) ON DELETE RESTRICT;

-- The HR sub-type (contract, id, certificate, ...). Free text rather than a
-- second enum so the list can grow without a migration; the UI offers a
-- fixed set. NULL for ordinary company documents.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS staff_doc_type text;

CREATE INDEX IF NOT EXISTS documents_employee_id_idx
  ON public.documents(employee_id, uploaded_at DESC)
  WHERE employee_id IS NOT NULL;

COMMENT ON COLUMN public.documents.employee_id IS
  'Set = a confidential staff record, visible only to finance_manager. NULL = an ordinary company document.';

-- ── 2. Table policies ──────────────────────────────────────────────────────
-- Replaces documents_select_all_authenticated, which returned true for every
-- signed-in account.
DROP POLICY IF EXISTS "documents_select_all_authenticated" ON public.documents;
DROP POLICY IF EXISTS "documents_select" ON public.documents;
CREATE POLICY "documents_select" ON public.documents
  FOR SELECT TO authenticated
  USING (
    employee_id IS NULL
    OR public.get_user_role() = 'finance_manager'
  );

DROP POLICY IF EXISTS "documents_insert" ON public.documents;
CREATE POLICY "documents_insert" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    CASE WHEN employee_id IS NULL
      THEN public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager')
      ELSE public.get_user_role() = 'finance_manager'
    END
  );

DROP POLICY IF EXISTS "documents_update" ON public.documents;
CREATE POLICY "documents_update" ON public.documents
  FOR UPDATE TO authenticated
  USING (
    CASE WHEN employee_id IS NULL
      THEN public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager')
      ELSE public.get_user_role() = 'finance_manager'
    END
  )
  WITH CHECK (
    CASE WHEN employee_id IS NULL
      THEN public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager')
      ELSE public.get_user_role() = 'finance_manager'
    END
  );

-- ── 3. Storage policies ────────────────────────────────────────────────────
-- Staff files live under the 'staff/' prefix. storage.foldername() returns
-- the path segments, so element 1 is 'staff' for those and NULL for a file at
-- the bucket root — IS DISTINCT FROM handles both without a NULL trap.
DROP POLICY IF EXISTS "finops_documents_select" ON storage.objects;
CREATE POLICY "finops_documents_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'finops-documents'
    AND (
      (storage.foldername(name))[1] IS DISTINCT FROM 'staff'
      OR public.get_user_role() = 'finance_manager'
    )
  );

DROP POLICY IF EXISTS "finops_documents_insert" ON storage.objects;
CREATE POLICY "finops_documents_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'finops-documents'
    AND (
      CASE WHEN (storage.foldername(name))[1] IS NOT DISTINCT FROM 'staff'
        THEN public.get_user_role() = 'finance_manager'
        ELSE public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager')
      END
    )
  );

DROP POLICY IF EXISTS "finops_documents_update" ON storage.objects;
CREATE POLICY "finops_documents_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'finops-documents'
    AND (
      CASE WHEN (storage.foldername(name))[1] IS NOT DISTINCT FROM 'staff'
        THEN public.get_user_role() = 'finance_manager'
        ELSE public.get_user_role() IN ('senior_accountant', 'finance_manager', 'production_manager')
      END
    )
  );

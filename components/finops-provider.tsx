"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { clearModuleUnlock } from "@/components/module-lock";
import {
  Vendor,
  Invoice,
  WhtPayment,
  GLAccount,
  Employee,
  ChecklistItem,
  AuditLog,
  BudgetItem,
  Document,
  initialGLAccounts,
  initialEmployees,
  initialBudgets,
} from "@/lib/seeds";

export type UserRole =
  | "senior_accountant"
  | "finance_manager"
  | "production_manager"
  | "business_controller";

export interface AuthProfile {
  full_name: string;
  role: UserRole;
  email: string;
}

interface FinOpsContextType {
  currentUser: string;
  currentUserRole: UserRole | null;
  currentUserEmail: string | null;
  authLoading: boolean;
  applyAuthProfile: (profile: AuthProfile) => void;
  signOut: () => Promise<void>;
  vendors: Vendor[];
  addVendor: (vendor: Vendor) => void;
  updateVendor: (vendor: Vendor) => void;
  invoices: Invoice[];
  addInvoice: (invoice: Invoice) => void;
  updateInvoice: (invoice: Invoice) => void;
  deleteInvoice: (id: string, reason: string) => void;
  whtPayments: WhtPayment[];
  addWhtPayment: (payment: WhtPayment) => void;
  fileWhtPayments: (ids: string[], kraReference: string) => void;
  glAccounts: GLAccount[];
  addGLAccount: (account: GLAccount) => void;
  employees: Employee[];
  updateEmployee: (emp: Employee) => void;
  checklist: ChecklistItem[];
  updateChecklistItem: (
    id: string,
    status: ChecklistItem["status"],
    approver?: string | null,
  ) => void;
  budgets: BudgetItem[];
  updateBudgetActual: (id: string, actual: number) => void;
  documents: Document[];
  uploadDocument: (file: File, tag: Document["tag"], displayName?: string) => Promise<void>;
  deleteDocument: (id: string, reason: string) => void;
  auditTrail: AuditLog[];
  addAuditLog: (
    action: string,
    docRef: string,
    details: string,
    amount?: number,
  ) => void;
  clearSession: () => void;
}

const FinOpsContext = createContext<FinOpsContextType | undefined>(undefined);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FinOpsProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<string>("");
  const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [whtPayments, setWhtPayments] = useState<WhtPayment[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditLog[]>([]);

  // These tables are out of scope for the current backend migration (no page
  // in this pass reads/writes them) — kept on local mock state for now.
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("finops_gl");
      return stored ? JSON.parse(stored) : initialGLAccounts;
    }
    return initialGLAccounts;
  });
  const [employees, setEmployees] = useState<Employee[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("finops_employees");
      return stored ? JSON.parse(stored) : initialEmployees;
    }
    return initialEmployees;
  });
  const [budgets, setBudgets] = useState<BudgetItem[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("finops_budgets");
      return stored ? JSON.parse(stored) : initialBudgets;
    }
    return initialBudgets;
  });

  const sync = (key: string, data: unknown) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(key, JSON.stringify(data));
    }
  };

  const applyAuthProfile = useCallback((profile: AuthProfile) => {
    setCurrentUserState(profile.full_name);
    setCurrentUserRole(profile.role);
    setCurrentUserEmail(profile.email);
  }, []);

  const signOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    // Re-lock Payroll and Employee Master. The module code lives in
    // sessionStorage, which signing out does not touch on its own, so
    // without this the next sign-in on the same tab skipped the code
    // prompt entirely.
    clearModuleUnlock();
    setCurrentUserState("");
    setCurrentUserRole(null);
    setCurrentUserEmail(null);
  }, []);

  // Hydrate the signed-in operator's identity from the Supabase session (page refresh,
  // direct navigation) and keep it in sync across tabs / token refresh.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    const loadProfile = async (userId: string) => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, role, email")
        .eq("id", userId)
        .single();

      if (data) {
        applyAuthProfile({
          full_name: data.full_name,
          role: data.role as UserRole,
          email: data.email,
        });
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadProfile(session.user.id).finally(() => setAuthLoading(false));
      } else {
        setAuthLoading(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setCurrentUserState("");
        setCurrentUserRole(null);
        setCurrentUserEmail(null);
      } else if (session?.user) {
        loadProfile(session.user.id);
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, [applyAuthProfile]);

  // Load real data from Supabase once the auth session state is known (RLS
  // returns zero rows for the `anon` role, so fetching before auth resolves
  // would just mean an extra empty round trip).
  useEffect(() => {
    if (authLoading) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    (async () => {
      const [
        vendorsRes,
        invoicesRes,
        whtRes,
        checklistRes,
        documentsRes,
        auditRes,
      ] = await Promise.all([
        supabase.from("vendors").select("*").order("name"),
        supabase.from("invoices").select("*").order("created_at", { ascending: false }),
        supabase.from("wht_payments").select("*").order("created_at", { ascending: false }),
        supabase.from("checklist_items").select("*").order("id"),
        supabase
          .from("documents")
          .select("*")
          .eq("is_deleted", false)
          .order("uploaded_at", { ascending: false }),
        // Capped: the trail grows without bound and every sign-in was
        // pulling the whole history into the browser before the app could
        // render. The Audit Trail page shows the most recent entries; the
        // full history stays queryable in the database.
        supabase.from("audit_logs").select("*").order("timestamp", { ascending: false }).limit(250),
      ]);

      if (vendorsRes.data) setVendors(vendorsRes.data as Vendor[]);
      if (invoicesRes.data) setInvoices(invoicesRes.data as Invoice[]);
      if (whtRes.data) setWhtPayments(whtRes.data as WhtPayment[]);
      if (checklistRes.data) setChecklist(checklistRes.data as ChecklistItem[]);
      if (documentsRes.data) {
        setDocuments(
          documentsRes.data.map((d: any) => ({
            id: d.id,
            name: d.name,
            tag: d.tag,
            uploaded_by: d.uploaded_by,
            uploaded_at: d.uploaded_at,
            size: formatBytes(d.size),
            storage_path: d.storage_path,
          })),
        );
      }
      if (auditRes.data) {
        setAuditTrail(
          auditRes.data.map((a: any) => ({
            id: a.id,
            timestamp: a.timestamp,
            user: a.operator_user,
            action: a.action,
            document_ref: a.document_ref,
            details: a.details,
            amount: a.amount ?? undefined,
          })),
        );
      }
    })();
  }, [authLoading]);

  const addAuditLog = useCallback(
    (action: string, docRef: string, details: string, amount?: number) => {
      const timeInNairobi = new Date().toLocaleString("en-US", {
        timeZone: "Africa/Nairobi",
      });
      const formattedTime = new Date(timeInNairobi)
        .toISOString()
        .replace("T", " ")
        .substring(0, 19);

      const id = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
      const newLog: AuditLog = {
        id,
        timestamp: formattedTime,
        user: currentUser,
        action,
        document_ref: docRef,
        details,
        amount,
      };

      setAuditTrail((prev) => [newLog, ...prev]);

      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        supabase
          .from("audit_logs")
          .insert({
            id,
            timestamp: formattedTime,
            operator_user: currentUser,
            action,
            document_ref: docRef,
            details,
            amount,
          })
          .then(({ error }) => {
            if (error) console.error("Failed to persist audit log:", error.message);
          });
      }
    },
    [currentUser],
  );

  const addVendor = useCallback((vendor: Vendor) => {
    setVendors((prev) => [...prev, vendor].sort((a, b) => a.name.localeCompare(b.name)));

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase
      .from("vendors")
      .insert(vendor)
      .then(({ error }) => {
        if (error) {
          alert(`Failed to save vendor: ${error.message}`);
          setVendors((prev) => prev.filter((v) => v.vendor_id !== vendor.vendor_id));
          return;
        }
        addAuditLog("VENDOR ADDED", vendor.vendor_id, `Created new vendor ${vendor.name} (${vendor.tax_id_pin})`);
      });
  }, [addAuditLog]);

  const updateVendor = useCallback((vendor: Vendor) => {
    setVendors((prev) => prev.map((v) => (v.vendor_id === vendor.vendor_id ? vendor : v)));

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase
      .from("vendors")
      .update(vendor)
      .eq("vendor_id", vendor.vendor_id)
      .then(({ error }) => {
        if (error) {
          alert(`Failed to update vendor: ${error.message}`);
          return;
        }
        addAuditLog("VENDOR UPDATED", vendor.vendor_id, `Updated vendor master configurations for ${vendor.name}`);
      });
  }, [addAuditLog]);

  const addInvoice = useCallback((invoice: Invoice) => {
    const { id: _tempId, ...invoiceWithoutId } = invoice;
    setInvoices((prev) => [invoice, ...prev]);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase
      .from("invoices")
      .insert(invoiceWithoutId)
      .select()
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          alert(`Failed to save invoice: ${error?.message ?? "unknown error"}`);
          setInvoices((prev) => prev.filter((i) => i.id !== invoice.id));
          return;
        }
        setInvoices((prev) => prev.map((i) => (i.id === invoice.id ? (data as Invoice) : i)));
        addAuditLog(
          "INVOICE UPLOADED",
          data.id,
          `Uploaded invoice ${invoice.invoice_number} for vendor ${invoice.vendor_name}`,
          invoice.total,
        );
      });
  }, [addAuditLog]);

  const updateInvoice = useCallback((invoice: Invoice) => {
    setInvoices((prev) => prev.map((i) => (i.id === invoice.id ? invoice : i)));

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { id, ...rest } = invoice;
    supabase
      .from("invoices")
      .update(rest)
      .eq("id", id)
      .then(({ error }) => {
        if (error) {
          alert(`Failed to update invoice: ${error.message}`);
          return;
        }
        addAuditLog(
          "INVOICE PROCESSED",
          invoice.id,
          `Status updated to ${invoice.status} for ${invoice.invoice_number}`,
          invoice.total,
        );
      });
  }, [addAuditLog]);

  const deleteInvoice = useCallback((id: string, reason: string) => {
    const target = invoices.find((i) => i.id === id);
    setInvoices((prev) => prev.filter((i) => i.id !== id));

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase
      .from("invoices")
      .delete()
      .eq("id", id)
      .then(({ error }) => {
        if (error) {
          alert(`Failed to delete invoice: ${error.message}`);
          if (target) setInvoices((prev) => [target, ...prev]);
          return;
        }
        addAuditLog(
          "DOCUMENT DELETED",
          id,
          `Deleted Invoice Ref: ${target?.invoice_number || id}. Reason: ${reason}`,
          target?.total,
        );
      });
  }, [invoices, addAuditLog]);

  const addWhtPayment = useCallback((payment: WhtPayment) => {
    const { id: _tempId, ...paymentWithoutId } = payment;
    setWhtPayments((prev) => [payment, ...prev]);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase
      .from("wht_payments")
      .insert(paymentWithoutId)
      .select()
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          alert(`Failed to save WHT payment: ${error?.message ?? "unknown error"}`);
          setWhtPayments((prev) => prev.filter((p) => p.id !== payment.id));
          return;
        }
        setWhtPayments((prev) => prev.map((p) => (p.id === payment.id ? (data as WhtPayment) : p)));
        addAuditLog(
          "WHT CALCULATED",
          data.id,
          `Calculated ${payment.wht_rate * 100}% withholding for invoice ${payment.cu_invoice_number}`,
          payment.wht_amount,
        );
      });
  }, [addAuditLog]);

  const fileWhtPayments = useCallback((ids: string[], kraReference: string) => {
    const realIds = ids.filter((id) => !id.startsWith("WHT-COMP-"));
    setWhtPayments((prev) =>
      prev.map((p) => (ids.includes(p.id) ? { ...p, status: "Filed" as const, kra_reference: kraReference } : p)),
    );

    const supabase = createSupabaseBrowserClient();
    if (!supabase || realIds.length === 0) return;
    supabase
      .from("wht_payments")
      .update({ status: "Filed", kra_reference: kraReference })
      .in("id", realIds)
      .then(({ error }) => {
        if (error) {
          alert(`Failed to file WHT payments: ${error.message}`);
          return;
        }
        addAuditLog(
          "WHT FILED",
          kraReference,
          `Filed bulk WHT remittance of ${ids.length} entries to iTax. Reference: ${kraReference}`,
        );
      });
  }, [addAuditLog]);

  const addGLAccount = (account: GLAccount) => {
    setGlAccounts((prev) => {
      const updated = [...prev, account];
      sync("finops_gl", updated);
      return updated;
    });
    addAuditLog(
      "CHART OF ACCOUNTS UPDATED",
      account.code,
      `Created GL Account: ${account.code} - ${account.name}`,
    );
  };

  const updateEmployee = (emp: Employee) => {
    setEmployees((prev) => {
      const updated = prev.map((e) => (e.id === emp.id ? emp : e));
      sync("finops_employees", updated);
      return updated;
    });
    addAuditLog(
      "PAYROLL UPDATED",
      emp.id,
      `Updated payroll lines for employee ${emp.name}`,
    );
  };

  const updateChecklistItem = useCallback((
    id: string,
    status: ChecklistItem["status"],
    approver?: string | null,
  ) => {
    const completed_date = status === "Complete" ? new Date().toISOString().substring(0, 10) : null;
    const finalApprover = status === "Complete" ? approver || currentUser : null;

    setChecklist((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status, completed_date, approver: finalApprover } : c)),
    );

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase
      .from("checklist_items")
      .update({ status, completed_date, approver: finalApprover })
      .eq("id", id)
      .then(({ error }) => {
        if (error) {
          alert(`Failed to update checklist item: ${error.message}`);
          return;
        }
        addAuditLog("MONTH_END TASK", id, `Marked close task ${id} as ${status}`);
      });
  }, [currentUser, addAuditLog]);

  const updateBudgetActual = (id: string, actual: number) => {
    setBudgets((prev) => {
      const updated = prev.map((b) => (b.id === id ? { ...b, actual_amount: actual } : b));
      sync("finops_budgets", updated);
      return updated;
    });
  };

  const uploadDocument = useCallback(async (file: File, tag: Document["tag"], displayName?: string) => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      alert("Backend is not configured — cannot upload documents.");
      return;
    }

    const name = displayName?.trim() || file.name;
    const storagePath = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    const { error: uploadError } = await supabase.storage
      .from("finops-documents")
      .upload(storagePath, file);

    if (uploadError) {
      alert(`Failed to upload file: ${uploadError.message}`);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("documents")
      .insert({
        name,
        tag,
        storage_path: storagePath,
        size: file.size,
        uploaded_by: currentUser,
        is_deleted: false,
      })
      .select()
      .single();

    if (insertError || !data) {
      alert(`Failed to index document: ${insertError?.message ?? "unknown error"}`);
      await supabase.storage.from("finops-documents").remove([storagePath]);
      return;
    }

    setDocuments((prev) => [
      {
        id: data.id,
        name: data.name,
        tag: data.tag,
        uploaded_by: data.uploaded_by,
        uploaded_at: data.uploaded_at,
        size: formatBytes(data.size),
        storage_path: data.storage_path,
      },
      ...prev,
    ]);

    addAuditLog("DOCUMENT STORED", data.id, `Uploaded file "${name}" tagged as ${tag}`);
  }, [currentUser, addAuditLog]);

  const deleteDocument = useCallback((id: string, reason: string) => {
    const doc = documents.find((d) => d.id === id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase
      .from("documents")
      .update({ is_deleted: true, deletion_reason: reason })
      .eq("id", id)
      .then(({ error }) => {
        if (error) {
          alert(`Failed to delete document: ${error.message}`);
          if (doc) setDocuments((prev) => [doc, ...prev]);
          return;
        }
        addAuditLog(
          "DOCUMENT DELETED",
          id,
          `Removed file "${doc?.name || id}" from Document Store. Reason: ${reason}`,
        );
      });
  }, [documents, addAuditLog]);

  const clearSession = () => {
    if (typeof window !== "undefined") {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <FinOpsContext.Provider
      value={{
        currentUser,
        currentUserRole,
        currentUserEmail,
        authLoading,
        applyAuthProfile,
        signOut,
        vendors,
        addVendor,
        updateVendor,
        invoices,
        addInvoice,
        updateInvoice,
        deleteInvoice,
        whtPayments,
        addWhtPayment,
        fileWhtPayments,
        glAccounts,
        addGLAccount,
        employees,
        updateEmployee,
        checklist,
        updateChecklistItem,
        budgets,
        updateBudgetActual,
        documents,
        uploadDocument,
        deleteDocument,
        auditTrail,
        addAuditLog,
        clearSession,
      }}
    >
      {children}
    </FinOpsContext.Provider>
  );
}

export function useFinOps() {
  const context = useContext(FinOpsContext);
  if (context === undefined) {
    throw new Error("useFinOps must be used within a FinOpsProvider");
  }
  return context;
}

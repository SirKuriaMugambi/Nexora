"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFinOps } from "@/components/finops-provider";
import { useTheme, ColorTheme, CardEdge, FONT_SCALES, FONT_FAMILIES, type FontScale, type FontFamily } from "@/components/theme-provider";
import Logo from "@/components/logo";
import BackButton from "@/components/back-button";
import {
  LayoutDashboard,
  CheckSquare,
  History,
  FileText,
  GitCompare,
  Scale,
  Percent,
  Users,
  Receipt,
  Coins,
  Globe,
  Wallet,
  Upload,
  PieChart,
  TrendingUp,
  FolderArchive,
  ListCollapse,
  FileSpreadsheet,
  Menu,
  X,
  Palette,
  Sun,
  Moon,
  Laptop,
  Check,
  LogOut,
  KeyRound,
  ArrowRight,
  Clock,
  Briefcase,
  IdCard,
  FolderLock,
} from "lucide-react";

interface NavItem {
  name: string;
  href: string;
  icon: any;
  restrictedToRole?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, currentUserRole, signOut } = useFinOps();
  const {
    theme,
    setTheme,
    colorTheme,
    setColorTheme,
    cardEdge,
    setCardEdge,
    fontScale,
    setFontScale,
    fontFamily,
    setFontFamily,
    accentBg,
    accentText,
    accentBadge,
    cardRadius,
    buttonRadius,
  } = useTheme();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState("");

  // Nairobi Time Clock
  useEffect(() => {
    const updateTime = () => {
      const options: Intl.DateTimeFormatOptions = {
        timeZone: "Africa/Nairobi",
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      };
      const formatter = new Intl.DateTimeFormat("en-US", options);
      setCurrentTime(formatter.format(new Date()) + " EAT");
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const navigation: NavSection[] = [
    {
      title: "Overview",
      items: [
        { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { name: "Month-End Close", href: "/month-end", icon: CheckSquare },
        { name: "Audit Trail", href: "/audit-trail", icon: History },
      ],
    },
    {
      title: "Accounts Payable",
      items: [
        { name: "Invoice Processing", href: "/invoice", icon: FileText },
        { name: "3-Way Matching", href: "/three-way-match", icon: GitCompare },
        { name: "AP Reconciliation", href: "/ap-reconciliation", icon: Scale },
        { name: "WHT Calculator", href: "/wht-calculator", icon: Percent },
        { name: "Vendor Master", href: "/vendors", icon: Users },
      ],
    },
    {
      title: "Accounts Receivable",
      items: [{ name: "AR Receipting", href: "/ar-receipting", icon: Receipt }],
    },
    {
      title: "Reconciliations",
      items: [
        {
          name: "Bank Reconciliation",
          href: "/bank-reconciliation",
          icon: Coins,
        },
        { name: "Intercompany", href: "/intercompany", icon: Globe },
      ],
    },
    {
      title: "Operations & Reports",
      items: [
        { name: "Payroll & PAYE", href: "/payroll", icon: Wallet, restrictedToRole: "finance_manager" },
        { name: "Variable Pay", href: "/variable-pay", icon: Upload, restrictedToRole: "finance_manager" },
        { name: "Employee Master", href: "/employees", icon: IdCard, restrictedToRole: "finance_manager" },
        { name: "Budget vs Actual", href: "/budget", icon: PieChart },
        {
          name: "Financial Statements",
          href: "/financial-statements",
          icon: FileSpreadsheet,
        },
        { name: "Cash Flow Forecaster", href: "/cashflow", icon: TrendingUp },
        {
          name: "Document Store",
          href: "/document-store",
          icon: FolderArchive,
        },
        {
          name: "Staff Documents",
          href: "/staff-documents",
          icon: FolderLock,
          restrictedToRole: "finance_manager",
        },
      ],
    },
    {
      title: "System",
      items: [
        {
          name: "Chart of Accounts",
          href: "/chart-of-accounts",
          icon: ListCollapse,
        },
      ],
    },
  ];

  const visibleNavigation: NavSection[] = navigation
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.restrictedToRole || item.restrictedToRole === currentUserRole
      ),
    }))
    .filter((section) => section.items.length > 0);

  const roleLabels: Record<string, string> = {
    senior_accountant: "Senior Accountant",
    finance_manager: "Finance Manager",
    production_manager: "Production Manager",
    business_controller: "Business Controller",
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/sign-in");
  };

  // Close menus on page transition
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950 font-sans text-xs antialiased">
      {/* Sidebar for Desktop */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 z-20">
        {/* Brand Header */}
        <div className="flex h-14 items-center justify-between px-4 border-b border-zinc-100 dark:border-zinc-900">
          <Link href="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-1.5 font-mono text-[9px] text-zinc-400">
            CHRY-AFR
          </div>
        </div>

        {/* Sidebar Nav Items */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800">
          {visibleNavigation.map((section) => (
            <div key={section.title} className="space-y-1">
              <h3 className="px-2 text-[9px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase font-mono">
                {section.title}
              </h3>
              <ul className="space-y-[2px]">
                {section.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <li key={item.name}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-2.5 px-2.5 py-1.5 transition-all text-[11px] group ${buttonRadius} ${
                          isActive
                            ? `${accentBadge} font-medium border-l-2 border-current pl-2`
                            : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-100/50 dark:hover:bg-zinc-900/50 border-l-2 border-transparent"
                        }`}
                      >
                        <item.icon
                          className={`h-3.5 w-3.5 shrink-0 ${isActive ? "" : "text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"}`}
                        />
                        <span>{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer with Session Control */}
        <div className="p-3 border-t border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-950/50">
          <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 uppercase">
                {currentUserRole ? roleLabels[currentUserRole] : "SYS_OPERATOR"}
              </span>
              <span suppressHydrationWarning className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200 truncate">
                {currentUser}
              </span>
            </div>
            <Link
              href="/change-password"
              title="Change password"
              className={`p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-900 ${buttonRadius} transition-colors`}
            >
              <KeyRound className="h-3.5 w-3.5" />
            </Link>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className={`p-1.5 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 ${buttonRadius} transition-colors`}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer (Overlay and Menu) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="relative flex w-64 max-w-xs flex-col bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-900 z-50">
            <div className="flex h-14 items-center justify-between px-4 border-b border-zinc-100 dark:border-zinc-900">
              <Link href="/">
                <Logo />
              </Link>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className={`p-1 ${buttonRadius} hover:bg-zinc-100 dark:hover:bg-zinc-900`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-4">
              {visibleNavigation.map((section) => (
                <div key={section.title} className="space-y-1">
                  <h3 className="px-2 text-[8px] font-mono font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {section.title}
                  </h3>
                  <ul className="space-y-[2px]">
                    {section.items.map((item) => {
                      const isActive = pathname === item.href;
                      return (
                        <li key={item.name}>
                          <Link
                            href={item.href}
                            className={`flex items-center gap-2.5 px-2.5 py-1.5 text-[11px] ${buttonRadius} ${
                              isActive
                                ? `${accentBadge} font-medium border-l-2 border-current pl-2`
                                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-100 dark:hover:bg-zinc-900 border-l-2 border-transparent"
                            }`}
                          >
                            <item.icon className="h-3.5 w-3.5 shrink-0" />
                            <span>{item.name}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
            <div className="p-3 border-t border-zinc-100 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950 flex items-center justify-between">
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] font-mono text-zinc-400 uppercase">
                  {currentUserRole ? roleLabels[currentUserRole] : "SYS_OPERATOR"}
                </span>
                <span className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200 truncate">
                  {currentUser}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className={`p-1.5 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 ${buttonRadius} transition-colors`}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:pl-60 min-w-0">
        {/* Workspace Top Header */}
        <header className="h-14 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-900 px-4 md:px-6 flex items-center justify-between shrink-0 z-10">
          <div className="flex items-center gap-3">
            {/* Mobile Toggle */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className={`md:hidden p-1.5 -ml-1.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors ${buttonRadius}`}
            >
              <Menu className="h-4 w-4" />
            </button>

            <BackButton className={buttonRadius} />

            {/* Path Display */}
            <div className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
              <span>ROOT</span>
              <ArrowRight className="h-2.5 w-2.5" />
              <span className="uppercase text-zinc-600 dark:text-zinc-300 font-semibold tracking-wider">
                {pathname.replace("/", "").replace("-", " ") || "DASHBOARD"}
              </span>
            </div>
          </div>

          {/* Time & User Switcher & Style Panel */}
          <div className="flex items-center gap-3">
            {/* Timezone Clock (Nairobi) */}
            <div className="hidden lg:flex items-center gap-2 text-zinc-500 dark:text-zinc-400 font-mono text-[10px] border-r border-zinc-200 dark:border-zinc-800 pr-3.5">
              <Clock className="h-3.5 w-3.5 text-zinc-400" />
              <span>{currentTime}</span>
            </div>

            {/* Signed-in Operator Identity */}
            <div className="hidden sm:flex items-center gap-2 border-r border-zinc-200 dark:border-zinc-800 pr-3.5">
              <span className="text-[10px] font-mono text-zinc-400 uppercase hidden xl:inline">
                Role_Context:
              </span>
              <span
                suppressHydrationWarning
                className="text-[11px] font-mono text-zinc-800 dark:text-zinc-200"
              >
                {currentUser} ({currentUserRole ? roleLabels[currentUserRole] : "—"})
              </span>
            </div>

            {/* Style Palette Button */}
            <div className="relative">
              <button
                onClick={() => setStylePanelOpen(!stylePanelOpen)}
                className={`flex items-center gap-1.5 px-2.5 py-1 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] ${buttonRadius} transition-colors font-mono`}
              >
                <Palette className="h-3.5 w-3.5" />
                <span>STYLE</span>
              </button>

              {/* Float Style panel */}
              {stylePanelOpen && (
                <div
                  className={`absolute right-0 mt-2 w-64 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-4 shadow-xl z-30 space-y-4 ${cardRadius}`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-900">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      System style configurator
                    </span>
                    <button
                      onClick={() => setStylePanelOpen(false)}
                      className={`p-0.5 text-zinc-400 hover:text-zinc-600 ${buttonRadius}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Mode toggle */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-mono text-zinc-400 uppercase">
                      DAYLIGHT vs ABYSS (MODE)
                    </span>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        onClick={() => setTheme("light")}
                        className={`flex items-center justify-center gap-1.5 py-1 border text-[11px] font-mono ${
                          theme === "light"
                            ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-bold"
                            : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                        } ${buttonRadius}`}
                      >
                        <Sun className="h-3 w-3" />
                        <span>Daylight</span>
                      </button>
                      <button
                        onClick={() => setTheme("dark")}
                        className={`flex items-center justify-center gap-1.5 py-1 border text-[11px] font-mono ${
                          theme === "dark"
                            ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-bold"
                            : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                        } ${buttonRadius}`}
                      >
                        <Moon className="h-3 w-3" />
                        <span>Abyss</span>
                      </button>
                    </div>
                  </div>

                  {/* Accent Color theme */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-mono text-zinc-400 uppercase">
                      COLOR SCHEME (ACCENT)
                    </span>
                    <div className="grid grid-cols-1 gap-1">
                      {[
                        {
                          id: "charcoal",
                          name: "Sleek Charcoal",
                          dot: "bg-zinc-500",
                        },
                        {
                          id: "moss",
                          name: "Forest Moss (Emerald)",
                          dot: "bg-emerald-500",
                        },
                        {
                          id: "navy",
                          name: "Classic Navy (Indigo)",
                          dot: "bg-blue-600",
                        },
                        {
                          id: "sand",
                          name: "Sand Dune (Gold)",
                          dot: "bg-amber-500",
                        },
                        {
                          id: "crimson",
                          name: "Warm Crimson (Rose)",
                          dot: "bg-rose-500",
                        },
                      ].map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setColorTheme(c.id as ColorTheme)}
                          className={`flex items-center justify-between px-2.5 py-1 border text-[10px] font-mono text-left ${
                            colorTheme === c.id
                              ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900 font-bold"
                              : "border-zinc-150 dark:border-zinc-850 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                          } ${buttonRadius}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                            <span>{c.name}</span>
                          </div>
                          {colorTheme === c.id && (
                            <Check className="h-3 w-3 text-zinc-800 dark:text-zinc-200" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Container Borders / Edges */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-mono text-zinc-400 uppercase">
                      CARD CONTURES (EDGES)
                    </span>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { id: "sharp", name: "Razor" },
                        { id: "rounded", name: "Tailored" },
                        { id: "playful", name: "Organic" },
                      ].map((e) => (
                        <button
                          key={e.id}
                          onClick={() => setCardEdge(e.id as CardEdge)}
                          className={`py-1 border text-[10px] font-mono ${
                            cardEdge === e.id
                              ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-bold"
                              : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 bg-transparent"
                          } ${buttonRadius}`}
                        >
                          {e.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font size */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-mono text-zinc-400 uppercase">
                      FONT SIZE
                    </span>
                    <div className="grid grid-cols-4 gap-1">
                      {(Object.keys(FONT_SCALES) as FontScale[]).map((id) => (
                        <button
                          key={id}
                          onClick={() => setFontScale(id)}
                          title={FONT_SCALES[id].name}
                          className={`py-1 border text-[10px] font-mono ${
                            fontScale === id
                              ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-bold"
                              : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 bg-transparent"
                          } ${buttonRadius}`}
                        >
                          {id === "compact" ? "A−" : id === "standard" ? "A" : id === "large" ? "A+" : "A++"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font type */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-mono text-zinc-400 uppercase">
                      FONT TYPE
                    </span>
                    <div className="grid grid-cols-1 gap-1">
                      {(Object.keys(FONT_FAMILIES) as FontFamily[]).map((id) => (
                        <button
                          key={id}
                          onClick={() => setFontFamily(id)}
                          style={{ fontFamily: FONT_FAMILIES[id].sans }}
                          className={`flex items-center justify-between px-2.5 py-1 border text-[11px] text-left ${
                            fontFamily === id
                              ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900 font-bold"
                              : "border-zinc-150 dark:border-zinc-850 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                          } ${buttonRadius}`}
                        >
                          <span>{FONT_FAMILIES[id].name}</span>
                          {fontFamily === id && (
                            <Check className="h-3 w-3 text-zinc-800 dark:text-zinc-200" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content Container */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
}

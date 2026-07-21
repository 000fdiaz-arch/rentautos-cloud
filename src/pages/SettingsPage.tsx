import { useState } from "react";
import type { BackupImportReport } from "../backupImport";
import BackupSettingsPanels from "./settings/BackupSettingsPanels";
import BankRulesSettingsPanel from "./settings/BankRulesSettingsPanel";
import FinesSettingsPanel from "./settings/FinesSettingsPanel";
import LateFeeSettingsPanel from "./settings/LateFeeSettingsPanel";
import OtherChargesSettingsPanel from "./settings/OtherChargesSettingsPanel";
import TicketsSettingsPanel from "./settings/TicketsSettingsPanel";
import UserPermissionsSettingsPanel from "./settings/UserPermissionsSettingsPanel";
import { isSupabaseOnlyMode } from "../persistenceMode";
import type {
  BankRule,
  Client,
  LateFeeSettings,
  OtherChargesRetentionByClient
} from "../types";

type SettingsTab = "backup" | "migration" | "late_fees" | "fines" | "tickets" | "other_charges" | "bank_rules" | "users";

type Props = {
  currentUserId?: string;
  canViewSettings: boolean;
  canEditSettings: boolean;
  canManageUsers: boolean;
  bankRules: BankRule[];
  clients: Client[];
  lateFeeSettings: LateFeeSettings;
  otherChargesRetentionByClient: OtherChargesRetentionByClient;
  onBankRulesChange: (next: BankRule[]) => void;
  onClientsChange: (next: Client[]) => void | Promise<void>;
  onLateFeeSettingsChange: (next: LateFeeSettings) => void;
  onOtherChargesRetentionByClientChange: (next: OtherChargesRetentionByClient) => void;
  onValidateBackupFile: (file: File) => Promise<BackupImportReport>;
  onApplyBackupImport: (report: BackupImportReport) => Promise<{ ok: boolean; message: string }>;
  onManualBackup: () => Promise<{ ok: boolean; message: string }>;
  onConfigureBackupFolder: () => Promise<{ ok: boolean; message: string }>;
  onDisconnectBackupFolder: () => Promise<{ ok: boolean; message: string }>;
  backupSupported: boolean;
  backupConfigured: boolean;
  backupRunning: boolean;
  backupStatus: string;
  hasPendingChanges: boolean;
  lastBackupAt: string;
};

function normalizeUnitId(value: string): string {
  return value.trim().toUpperCase();
}

export default function SettingsPage({
  currentUserId,
  canViewSettings,
  canEditSettings,
  canManageUsers,
  bankRules,
  clients,
  lateFeeSettings,
  otherChargesRetentionByClient,
  onBankRulesChange,
  onClientsChange,
  onLateFeeSettingsChange,
  onOtherChargesRetentionByClientChange,
  onValidateBackupFile,
  onApplyBackupImport,
  onManualBackup,
  onConfigureBackupFolder,
  onDisconnectBackupFolder,
  backupSupported,
  backupConfigured,
  backupRunning,
  backupStatus,
  hasPendingChanges,
  lastBackupAt
}: Props) {
  const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
    ...(canViewSettings ? [
      { id: "backup" as const, label: "Respaldo" },
      { id: "migration" as const, label: "Migracion" },
      { id: "late_fees" as const, label: "Recargos" },
      ...(isSupabaseOnlyMode ? [{ id: "fines" as const, label: "Multas" }] : []),
      ...(isSupabaseOnlyMode ? [{ id: "tickets" as const, label: "Boletas" }] : []),
      { id: "other_charges" as const, label: "Otros cargos" },
      { id: "bank_rules" as const, label: "Regla bancaria" }
    ] : []),
    ...(canManageUsers ? [{ id: "users" as const, label: "Usuarios" }] : [])
  ];
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>(settingsTabs[0]?.id ?? "users");
  const activeTabVisible = settingsTabs.some((tab) => tab.id === activeSettingsTab);
  const visibleActiveTab = activeTabVisible ? activeSettingsTab : settingsTabs[0]?.id;

  return (
    <>
      <section className="panel settings-tabs-panel">
        <div className="panel-head">
          <h2>Configuraciones</h2>
        </div>
        <div className="cash-view-tabs settings-tabs">
          {settingsTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`button ghost small ${visibleActiveTab === tab.id ? "cash-tab-active" : ""}`}
              onClick={() => setActiveSettingsTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {(visibleActiveTab === "backup" || visibleActiveTab === "migration") && canViewSettings && (
        <BackupSettingsPanels
          activeTab={visibleActiveTab}
          backupSupported={backupSupported}
          backupConfigured={backupConfigured}
          backupRunning={backupRunning}
          backupStatus={backupStatus}
          hasPendingChanges={hasPendingChanges}
          lastBackupAt={lastBackupAt}
          onValidateBackupFile={onValidateBackupFile}
          onApplyBackupImport={onApplyBackupImport}
          onManualBackup={onManualBackup}
          onConfigureBackupFolder={onConfigureBackupFolder}
          onDisconnectBackupFolder={onDisconnectBackupFolder}
        />
      )}

      {visibleActiveTab === "late_fees" && canViewSettings && <LateFeeSettingsPanel clients={clients} settings={lateFeeSettings} onChange={canEditSettings ? onLateFeeSettingsChange : () => undefined} />}

      {isSupabaseOnlyMode && visibleActiveTab === "fines" && canViewSettings && <FinesSettingsPanel clients={clients} onClientsChange={canEditSettings ? onClientsChange : () => undefined} />}

      {isSupabaseOnlyMode && visibleActiveTab === "tickets" && canViewSettings && <TicketsSettingsPanel clients={clients} onClientsChange={canEditSettings ? onClientsChange : () => undefined} />}

      {visibleActiveTab === "other_charges" && canViewSettings && <OtherChargesSettingsPanel clients={clients} settings={otherChargesRetentionByClient} onChange={canEditSettings ? onOtherChargesRetentionByClientChange : () => undefined} />}

      {visibleActiveTab === "bank_rules" && canViewSettings && <BankRulesSettingsPanel bankRules={bankRules} onChange={canEditSettings ? onBankRulesChange : () => undefined} />}

      {visibleActiveTab === "users" && canManageUsers && <UserPermissionsSettingsPanel currentUserId={currentUserId} />}
    </>
  );
}

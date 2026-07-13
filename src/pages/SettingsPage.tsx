import { useState } from "react";
import type { BackupImportReport } from "../backupImport";
import BackupSettingsPanels from "./settings/BackupSettingsPanels";
import BankRulesSettingsPanel from "./settings/BankRulesSettingsPanel";
import LateFeeSettingsPanel from "./settings/LateFeeSettingsPanel";
import OtherChargesSettingsPanel from "./settings/OtherChargesSettingsPanel";
import type {
  BankRule,
  Client,
  LateFeeSettings,
  OtherChargesRetentionByClient
} from "../types";

type SettingsTab = "backup" | "migration" | "late_fees" | "other_charges" | "bank_rules";

type Props = {
  bankRules: BankRule[];
  clients: Client[];
  lateFeeSettings: LateFeeSettings;
  otherChargesRetentionByClient: OtherChargesRetentionByClient;
  onBankRulesChange: (next: BankRule[]) => void;
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

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "backup", label: "Respaldo" },
  { id: "migration", label: "Migracion" },
  { id: "late_fees", label: "Recargos" },
  { id: "other_charges", label: "Otros cargos" },
  { id: "bank_rules", label: "Regla bancaria" }
];

function normalizeUnitId(value: string): string {
  return value.trim().toUpperCase();
}

export default function SettingsPage({
  bankRules,
  clients,
  lateFeeSettings,
  otherChargesRetentionByClient,
  onBankRulesChange,
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
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("backup");

  return (
    <>
      <section className="panel settings-tabs-panel">
        <div className="panel-head">
          <h2>Configuraciones</h2>
        </div>
        <div className="cash-view-tabs settings-tabs">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`button ghost small ${activeSettingsTab === tab.id ? "cash-tab-active" : ""}`}
              onClick={() => setActiveSettingsTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {(activeSettingsTab === "backup" || activeSettingsTab === "migration") && (
        <BackupSettingsPanels
          activeTab={activeSettingsTab}
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

      {activeSettingsTab === "late_fees" && <LateFeeSettingsPanel clients={clients} settings={lateFeeSettings} onChange={onLateFeeSettingsChange} />}

      {activeSettingsTab === "other_charges" && <OtherChargesSettingsPanel clients={clients} settings={otherChargesRetentionByClient} onChange={onOtherChargesRetentionByClientChange} />}

      {activeSettingsTab === "bank_rules" && <BankRulesSettingsPanel bankRules={bankRules} onChange={onBankRulesChange} />}
    </>
  );
}

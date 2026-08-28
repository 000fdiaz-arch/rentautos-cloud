import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { findNextChargeDay, getDebtStartDate, getPendingInstallments } from "../../billing";
import type { BankRule, Client } from "../../types";
import { normalizePersonName } from "./clientRules";
import type {
  ClientDirectoryRow,
  GeneralGroupFilterKey,
  PlanFilterKey,
  WeeklyChargeDayFilterKey
} from "./clientTypes";

export function useClientDirectoryRows(
  clients: Client[],
  fleetUnitOptions: string[],
  operationalReferenceDate: Date
) {
  const rows = useMemo<ClientDirectoryRow[]>(() => {
    const activeClients = clients.filter((client) => client.status !== "archivado");
    const clientByUnit = new Map<string, Client>();
    const provisionalClientByUnit = new Map<string, Client>();
    for (const client of activeClients) {
      const key = client.unitId.trim().toUpperCase();
      if (key && !clientByUnit.has(key)) clientByUnit.set(key, client);

      const provisionalKey = client.activeProvisionalRental?.unitId.trim().toUpperCase() ?? "";
      if (provisionalKey && !provisionalClientByUnit.has(provisionalKey)) {
        provisionalClientByUnit.set(provisionalKey, client);
      }
    }

    const fleetUnits = fleetUnitOptions
      .map((unitId) => unitId.trim().toUpperCase())
      .filter((unitId) => unitId.length > 0);
    const clientUnits = Array.from(new Set(
      activeClients
        .map((client) => client.unitId.trim().toUpperCase())
        .filter((unitId) => unitId.length > 0)
    ));
    const units = fleetUnits.length > 0 ? fleetUnits : clientUnits;

    const unitRows = units.map((unitId): ClientDirectoryRow => {
      const provisionalClient = provisionalClientByUnit.get(unitId) ?? null;
      const client = provisionalClient ?? clientByUnit.get(unitId) ?? null;
      if (!client) {
        return {
          unitId,
          client: null,
          assignmentKind: null,
          debtStartDate: null,
          nextChargeDate: null,
          pendingInstallments: 0
        };
      }
      if (provisionalClient) {
        return {
          unitId,
          client,
          assignmentKind: "provisional",
          debtStartDate: null,
          nextChargeDate: null,
          pendingInstallments: 0
        };
      }
      const debtStartDate = getDebtStartDate(client, operationalReferenceDate);
      return {
        unitId,
        client,
        assignmentKind: "regular",
        debtStartDate,
        nextChargeDate: debtStartDate ? null : findNextChargeDay(client, operationalReferenceDate),
        pendingInstallments: getPendingInstallments(client)
      };
    });

    return unitRows
      .sort((left, right) => left.unitId.localeCompare(right.unitId, undefined, { numeric: true }));
  }, [clients, fleetUnitOptions, operationalReferenceDate]);

  const legacyClients = useMemo(() => {
    const fleetUnits = new Set(
      fleetUnitOptions
        .map((unit) => unit.trim().toUpperCase())
        .filter((unit) => unit.length > 0)
    );

    return clients
      .filter((client) => {
        if (client.status === "archivado") return true;
        const unit = client.unitId.trim().toUpperCase();
        return !unit || !fleetUnits.has(unit);
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [clients, fleetUnitOptions]);

  return { rows, legacyClients };
}

export function getRowGroup(unitId: string): string {
  return unitId.trim().toUpperCase().match(/^([A-Z])/)?.[1] ?? "";
}

type FilterOptions = {
  rows: ClientDirectoryRow[];
  bankRules: BankRule[];
};

export function useClientDirectoryFilters({
  rows,
  bankRules
}: FilterOptions) {
  const [generalGroupFilter, setGeneralGroupFilter] = useState<GeneralGroupFilterKey>("ALL");
  const [planFilter, setPlanFilter] = useState<PlanFilterKey>("ALL");
  const [weeklyChargeDayFilter, setWeeklyChargeDayFilter] = useState<WeeklyChargeDayFilterKey>("ALL");
  const [unitSearchFilter, setUnitSearchFilter] = useState("");
  const [clientNameSearchFilter, setClientNameSearchFilter] = useState("");
  const deferredUnitSearch = useDeferredValue(unitSearchFilter);
  const deferredClientSearch = useDeferredValue(clientNameSearchFilter);
  const groupOptions = useMemo(() => Array.from(new Set([
    ...bankRules
      .filter((rule) => rule.active)
      .map((rule) => rule.groupCode.trim().toUpperCase())
      .filter((group) => /^[A-Z]$/.test(group)),
    ...rows.map((row) => getRowGroup(row.unitId)).filter(Boolean)
  ])).sort((left, right) => left.localeCompare(right)), [bankRules, rows]);

  useEffect(() => {
    if (generalGroupFilter !== "ALL" && !groupOptions.includes(generalGroupFilter)) {
      setGeneralGroupFilter("ALL");
    }
  }, [generalGroupFilter, groupOptions]);

  const displayedRows = useMemo(() => {
    let filteredRows = generalGroupFilter === "ALL"
      ? rows
      : rows.filter((row) => getRowGroup(row.unitId) === generalGroupFilter);
    const unitQuery = normalizePersonName(deferredUnitSearch);
    const clientQuery = normalizePersonName(deferredClientSearch);

    if (planFilter !== "ALL") {
      filteredRows = filteredRows.filter((row) => row.client?.frequency === planFilter);
    }
    if (planFilter === "weekly" && weeklyChargeDayFilter !== "ALL") {
      filteredRows = filteredRows.filter((row) => row.client?.weeklyChargeDay === weeklyChargeDayFilter);
    }
    if (unitQuery) {
      filteredRows = filteredRows.filter((row) => normalizePersonName(row.unitId).includes(unitQuery));
    }
    if (clientQuery) {
      filteredRows = filteredRows.filter((row) =>
        Boolean(row.client) && normalizePersonName(row.client?.name ?? "").includes(clientQuery)
      );
    }
    return filteredRows;
  }, [
    deferredClientSearch,
    deferredUnitSearch,
    generalGroupFilter,
    planFilter,
    weeklyChargeDayFilter,
    rows
  ]);

  return {
    displayedRows,
    groupOptions,
    generalGroupFilter,
    setGeneralGroupFilter,
    planFilter,
    setPlanFilter,
    weeklyChargeDayFilter,
    setWeeklyChargeDayFilter,
    unitSearchFilter,
    setUnitSearchFilter,
    clientNameSearchFilter,
    setClientNameSearchFilter
  };
}

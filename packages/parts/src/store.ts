/**
 * High-level SQLite database store wrapper for @openharness/parts.
 *
 * Provides synchronous access, runs forward-only migrations at open,
 * and exposes typed CRUD operations for all master library tables.
 */

import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';
import * as accessors from './accessors.js';
import type {
  ConnectorFamily,
  ConnectorFamilyInput,
  ConnectorPart,
  ConnectorPartInput,
  Cavity,
  CavityInput,
  ContactPart,
  ContactPartInput,
  BackshellPart,
  BackshellPartInput,
  WireSpecPart,
  WireSpecPartInput,
  ToolingPart,
  ToolingPartInput,
  PartRevisionLogEntry,
  PartType,
  SpoolLengthDisplayUnit,
  Supplier,
  SupplierInput,
  PartSourcing,
  PartSourcingInput,
  PriceHistoryEntry,
} from './types.js';
import type { Gauge, GaugeUnit } from '@openharness/core';

export interface OpenDatabaseOptions extends Database.Options {
  targetVersion?: number;
}

export class PartsDatabase {
  readonly db: Database.Database;

  constructor(filePath: string = ':memory:', options?: OpenDatabaseOptions) {
    this.db = new DatabaseConstructor(filePath, options);
    runMigrations(this.db, options?.targetVersion);
  }

  get rawDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // -------------------------------------------------------------------------
  // Connector Families
  // -------------------------------------------------------------------------

  createConnectorFamily(input: ConnectorFamilyInput): ConnectorFamily {
    return accessors.createConnectorFamily(this.db, input);
  }

  getConnectorFamily(id: number): ConnectorFamily | null {
    return accessors.getConnectorFamily(this.db, id);
  }

  listConnectorFamilies(): ConnectorFamily[] {
    return accessors.listConnectorFamilies(this.db);
  }

  updateConnectorFamily(
    id: number,
    input: Partial<ConnectorFamilyInput>,
    changedBy?: string | null,
  ): ConnectorFamily {
    return accessors.updateConnectorFamily(this.db, id, input, changedBy);
  }

  deleteConnectorFamily(id: number, changedBy?: string | null): boolean {
    return accessors.deleteConnectorFamily(this.db, id, changedBy);
  }

  // -------------------------------------------------------------------------
  // Connectors
  // -------------------------------------------------------------------------

  createConnector(input: ConnectorPartInput): ConnectorPart {
    return accessors.createConnector(this.db, input);
  }

  getConnector(id: number): ConnectorPart | null {
    return accessors.getConnector(this.db, id);
  }

  getConnectorByPartNumber(partNumber: string): ConnectorPart | null {
    return accessors.getConnectorByPartNumber(this.db, partNumber);
  }

  listConnectors(filter?: { family_id?: number }): ConnectorPart[] {
    return accessors.listConnectors(this.db, filter);
  }

  updateConnector(
    idOrPartNumber: number | string,
    input: Partial<ConnectorPartInput>,
    changedBy?: string | null,
  ): ConnectorPart {
    return accessors.updateConnector(this.db, idOrPartNumber, input, changedBy);
  }

  deleteConnector(idOrPartNumber: number | string, changedBy?: string | null): boolean {
    return accessors.deleteConnector(this.db, idOrPartNumber, changedBy);
  }

  // -------------------------------------------------------------------------
  // Cavities
  // -------------------------------------------------------------------------

  createCavity(input: CavityInput): Cavity {
    return accessors.createCavity(this.db, input);
  }

  createCavities(inputs: CavityInput[]): Cavity[] {
    return accessors.createCavities(this.db, inputs);
  }

  getCavitiesForConnector(connectorId: number): Cavity[] {
    return accessors.getCavitiesForConnector(this.db, connectorId);
  }

  deleteCavity(id: number): boolean {
    return accessors.deleteCavity(this.db, id);
  }

  // -------------------------------------------------------------------------
  // Contacts
  // -------------------------------------------------------------------------

  createContact(input: ContactPartInput): ContactPart {
    return accessors.createContact(this.db, input);
  }

  getContact(id: number): ContactPart | null {
    return accessors.getContact(this.db, id);
  }

  getContactByPartNumber(partNumber: string): ContactPart | null {
    return accessors.getContactByPartNumber(this.db, partNumber);
  }

  listContacts(): ContactPart[] {
    return accessors.listContacts(this.db);
  }

  updateContact(
    idOrPartNumber: number | string,
    input: Partial<ContactPartInput>,
    changedBy?: string | null,
  ): ContactPart {
    return accessors.updateContact(this.db, idOrPartNumber, input, changedBy);
  }

  deleteContact(idOrPartNumber: number | string, changedBy?: string | null): boolean {
    return accessors.deleteContact(this.db, idOrPartNumber, changedBy);
  }

  // -------------------------------------------------------------------------
  // Backshells & Compatibility
  // -------------------------------------------------------------------------

  createBackshell(input: BackshellPartInput): BackshellPart {
    return accessors.createBackshell(this.db, input);
  }

  getBackshell(id: number): BackshellPart | null {
    return accessors.getBackshell(this.db, id);
  }

  getBackshellByPartNumber(partNumber: string): BackshellPart | null {
    return accessors.getBackshellByPartNumber(this.db, partNumber);
  }

  listBackshells(): BackshellPart[] {
    return accessors.listBackshells(this.db);
  }

  updateBackshell(
    idOrPartNumber: number | string,
    input: Partial<BackshellPartInput>,
    changedBy?: string | null,
  ): BackshellPart {
    return accessors.updateBackshell(this.db, idOrPartNumber, input, changedBy);
  }

  deleteBackshell(idOrPartNumber: number | string, changedBy?: string | null): boolean {
    return accessors.deleteBackshell(this.db, idOrPartNumber, changedBy);
  }

  setBackshellCompatibility(backshellId: number, familyIds: number[]): void {
    accessors.setBackshellCompatibility(this.db, backshellId, familyIds);
  }

  getBackshellCompatibleFamilies(backshellId: number): ConnectorFamily[] {
    return accessors.getBackshellCompatibleFamilies(this.db, backshellId);
  }

  getCompatibleBackshellsForFamily(familyId: number): BackshellPart[] {
    return accessors.getCompatibleBackshellsForFamily(this.db, familyId);
  }

  // -------------------------------------------------------------------------
  // Wire Specs
  // -------------------------------------------------------------------------

  createWireSpec(input: WireSpecPartInput): WireSpecPart {
    return accessors.createWireSpec(this.db, input);
  }

  getWireSpec(id: number): WireSpecPart | null {
    return accessors.getWireSpec(this.db, id);
  }

  getWireSpecByPartNumber(partNumber: string): WireSpecPart | null {
    return accessors.getWireSpecByPartNumber(this.db, partNumber);
  }

  listWireSpecs(): WireSpecPart[] {
    return accessors.listWireSpecs(this.db);
  }

  updateWireSpec(
    idOrPartNumber: number | string,
    input: Partial<WireSpecPartInput>,
    changedBy?: string | null,
  ): WireSpecPart {
    return accessors.updateWireSpec(this.db, idOrPartNumber, input, changedBy);
  }

  deleteWireSpec(idOrPartNumber: number | string, changedBy?: string | null): boolean {
    return accessors.deleteWireSpec(this.db, idOrPartNumber, changedBy);
  }

  // -------------------------------------------------------------------------
  // Tooling & Compatibility
  // -------------------------------------------------------------------------

  createTooling(input: ToolingPartInput): ToolingPart {
    return accessors.createTooling(this.db, input);
  }

  getTooling(id: number): ToolingPart | null {
    return accessors.getTooling(this.db, id);
  }

  getToolingByPartNumber(partNumber: string): ToolingPart | null {
    return accessors.getToolingByPartNumber(this.db, partNumber);
  }

  listTooling(): ToolingPart[] {
    return accessors.listTooling(this.db);
  }

  updateTooling(
    idOrPartNumber: number | string,
    input: Partial<ToolingPartInput>,
    changedBy?: string | null,
  ): ToolingPart {
    return accessors.updateTooling(this.db, idOrPartNumber, input, changedBy);
  }

  deleteTooling(idOrPartNumber: number | string, changedBy?: string | null): boolean {
    return accessors.deleteTooling(this.db, idOrPartNumber, changedBy);
  }

  setToolingCompatibility(toolingId: number, familyIds: number[]): void {
    accessors.setToolingCompatibility(this.db, toolingId, familyIds);
  }

  getToolingCompatibleFamilies(toolingId: number): ConnectorFamily[] {
    return accessors.getToolingCompatibleFamilies(this.db, toolingId);
  }

  getCompatibleToolingForFamily(familyId: number): ToolingPart[] {
    return accessors.getCompatibleToolingForFamily(this.db, familyId);
  }

  // -------------------------------------------------------------------------
  // Part Revision Log
  // -------------------------------------------------------------------------

  getPartRevisionLogs(partNumber: string, partType?: PartType): PartRevisionLogEntry[] {
    return accessors.getPartRevisionLogs(this.db, partNumber, partType);
  }

  listAllRevisionLogs(): PartRevisionLogEntry[] {
    return accessors.listAllRevisionLogs(this.db);
  }

  replayPartRevisions<T extends { version: number }>(
    currentPart: T,
    partType: PartType,
    logs: PartRevisionLogEntry[],
    targetVersion: number,
  ): T {
    return accessors.replayPartRevisions(currentPart, partType, logs, targetVersion);
  }

  // -------------------------------------------------------------------------
  // Suppliers (T18)
  // -------------------------------------------------------------------------

  createSupplier(input: SupplierInput): Supplier {
    return accessors.createSupplier(this.db, input);
  }

  getSupplier(id: number): Supplier | null {
    return accessors.getSupplier(this.db, id);
  }

  getSupplierByName(name: string): Supplier | null {
    return accessors.getSupplierByName(this.db, name);
  }

  listSuppliers(): Supplier[] {
    return accessors.listSuppliers(this.db);
  }

  updateSupplier(id: number, input: Partial<SupplierInput>): Supplier {
    return accessors.updateSupplier(this.db, id, input);
  }

  deleteSupplier(id: number): boolean {
    return accessors.deleteSupplier(this.db, id);
  }

  // -------------------------------------------------------------------------
  // Part Sourcing (T18)
  // -------------------------------------------------------------------------

  createPartSourcing(input: PartSourcingInput): PartSourcing {
    return accessors.createPartSourcing(this.db, input);
  }

  getPartSourcing(partNumber: string, partType: PartType, supplierId: number): PartSourcing | null {
    return accessors.getPartSourcing(this.db, partNumber, partType, supplierId);
  }

  listPartSourcingForPart(partNumber: string, partType?: PartType): PartSourcing[] {
    return accessors.listPartSourcingForPart(this.db, partNumber, partType);
  }

  listPartSourcingForSupplier(supplierId: number): PartSourcing[] {
    return accessors.listPartSourcingForSupplier(this.db, supplierId);
  }

  listAllPartSourcing(): PartSourcing[] {
    return accessors.listAllPartSourcing(this.db);
  }

  getPreferredSourcing(partNumber: string, partType?: PartType): PartSourcing | null {
    return accessors.getPreferredSourcing(this.db, partNumber, partType);
  }

  updatePartSourcing(
    partNumber: string,
    partType: PartType,
    supplierId: number,
    input: Partial<PartSourcingInput>,
  ): PartSourcing {
    return accessors.updatePartSourcing(this.db, partNumber, partType, supplierId, input);
  }

  setPreferredSupplier(
    partNumber: string,
    partType: PartType,
    supplierId: number,
  ): PartSourcing {
    return accessors.setPreferredSupplier(this.db, partNumber, partType, supplierId);
  }

  deletePartSourcing(partNumber: string, partType: PartType, supplierId: number): boolean {
    return accessors.deletePartSourcing(this.db, partNumber, partType, supplierId);
  }

  // -------------------------------------------------------------------------
  // Price History (T18)
  // -------------------------------------------------------------------------

  getPriceHistory(
    partNumber: string,
    partType?: PartType,
    supplierId?: number,
  ): PriceHistoryEntry[] {
    return accessors.getPriceHistory(this.db, partNumber, partType, supplierId);
  }

  listAllPriceHistory(): PriceHistoryEntry[] {
    return accessors.listAllPriceHistory(this.db);
  }

  // -------------------------------------------------------------------------
  // Formatting / Conversion Helpers
  // -------------------------------------------------------------------------

  renderSpoolLength(wire: WireSpecPart): { value: number; unit: SpoolLengthDisplayUnit } | undefined {
    return accessors.renderSpoolLength(wire);
  }

  formatSpoolLength(wire: WireSpecPart): string | undefined {
    return accessors.formatSpoolLength(wire);
  }

  getWireSpecGauge(wire: WireSpecPart, unit: GaugeUnit = 'mm2'): Gauge {
    return accessors.getWireSpecGauge(wire, unit);
  }
}

/**
 * Open or create a parts library SQLite database.
 */
export function openPartsDatabase(
  filePath: string = ':memory:',
  options?: OpenDatabaseOptions,
): PartsDatabase {
  return new PartsDatabase(filePath, options);
}

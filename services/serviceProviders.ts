import { db, generateId } from './db';
import type { ServiceProvider, UtilityType } from '@/types';

export type { ServiceProvider };

type ProviderRow = {
  id: string;
  property_id: string;
  type: string;
  provider_name: string | null;
  customer_code: string | null;
  consumption_point_code: string | null;
  support_phone: string | null;
  created_at: string;
};

function mapRow(r: ProviderRow): ServiceProvider {
  return {
    id: r.id,
    property_id: r.property_id,
    type: r.type as UtilityType,
    provider_name: r.provider_name ?? undefined,
    customer_code: r.customer_code ?? undefined,
    consumption_point_code: r.consumption_point_code ?? undefined,
    support_phone: r.support_phone ?? undefined,
    created_at: r.created_at,
  };
}

export interface AddServiceProviderInput {
  type: UtilityType;
  provider_name?: string;
  customer_code?: string;
  consumption_point_code?: string;
  support_phone?: string;
}

export interface UpdateServiceProviderInput extends AddServiceProviderInput {}

export async function getServiceProviders(propertyId: string): Promise<ServiceProvider[]> {
  const rows = await db.getAllAsync<ProviderRow>(
    'SELECT * FROM service_providers WHERE property_id = ? ORDER BY created_at ASC',
    [propertyId]
  );
  return rows.map(mapRow);
}

export async function getAllServiceProviders(): Promise<ServiceProvider[]> {
  const rows = await db.getAllAsync<ProviderRow>(
    'SELECT * FROM service_providers ORDER BY created_at ASC'
  );
  return rows.map(mapRow);
}

export async function addServiceProvider(
  propertyId: string,
  input: AddServiceProviderInput
): Promise<ServiceProvider> {
  const id = generateId();
  const created_at = new Date().toISOString();
  const row: ServiceProvider = {
    id,
    property_id: propertyId,
    type: input.type,
    provider_name: input.provider_name?.trim() || undefined,
    customer_code: input.customer_code?.trim() || undefined,
    consumption_point_code: input.consumption_point_code?.trim() || undefined,
    support_phone: input.support_phone?.trim() || undefined,
    created_at,
  };
  await db.runAsync(
    `INSERT INTO service_providers
       (id, property_id, type, provider_name, customer_code,
        consumption_point_code, support_phone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.property_id,
      row.type,
      row.provider_name ?? null,
      row.customer_code ?? null,
      row.consumption_point_code ?? null,
      row.support_phone ?? null,
      row.created_at,
    ]
  );
  return row;
}

export async function updateServiceProvider(
  id: string,
  fields: UpdateServiceProviderInput
): Promise<void> {
  await db.runAsync(
    `UPDATE service_providers
       SET type = ?, provider_name = ?, customer_code = ?,
           consumption_point_code = ?, support_phone = ?
     WHERE id = ?`,
    [
      fields.type,
      fields.provider_name?.trim() || null,
      fields.customer_code?.trim() || null,
      fields.consumption_point_code?.trim() || null,
      fields.support_phone?.trim() || null,
      id,
    ]
  );
}

export async function deleteServiceProvider(id: string): Promise<void> {
  await db.runAsync('DELETE FROM service_providers WHERE id = ?', [id]);
}

export async function deleteServiceProvidersForProperty(propertyId: string): Promise<void> {
  await db.runAsync('DELETE FROM service_providers WHERE property_id = ?', [propertyId]);
}

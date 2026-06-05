import { sanitizeFolderName, relPathForDoc, buildEntityFileMap } from '@/services/fileOrganization';

const maps = {
  personNames: new Map([['p1', 'Ion Pop']]),
  vehicleNames: new Map([['v1', 'Dacia Logan']]),
  propertyNames: new Map(),
  cardNames: new Map(),
  animalNames: new Map(),
  companyNames: new Map(),
  customTypeNames: new Map([['c1', 'BCAA Card']]),
};

it('sanitizes folder names', () => {
  expect(sanitizeFolderName('a/b:c')).toBe('a_b_c');
  expect(sanitizeFolderName('   ')).toBe('General');
});

it('builds <Entity>/<DocType>/<filename> for a vehicle RCA', () => {
  const doc = { id: 'd1', type: 'rca', vehicle_id: 'v1', file_path: 'documents/abc.jpg' } as never;
  expect(relPathForDoc(doc, 'documents/abc.jpg', maps)).toBe('Dacia Logan/RCA/abc.jpg');
});

it('uses custom type name for custom docs', () => {
  const doc = { id: 'd2', type: 'custom', custom_type_id: 'c1', person_id: 'p1', file_path: 'documents/x.pdf' } as never;
  expect(relPathForDoc(doc, 'documents/x.pdf', maps)).toBe('Ion Pop/BCAA Card/x.pdf');
});

it('buildEntityFileMap maps disk path → structured path for docs and pages', () => {
  const docs = [{ id: 'd1', type: 'rca', vehicle_id: 'v1', file_path: 'documents/abc.jpg' }] as never[];
  const pages = [{ document_id: 'd1', file_path: 'documents/abc_p2.jpg' }] as never[];
  const map = buildEntityFileMap(docs, pages, maps);
  expect(map['documents/abc.jpg']).toBe('Dacia Logan/RCA/abc.jpg');
  expect(map['documents/abc_p2.jpg']).toBe('Dacia Logan/RCA/abc_p2.jpg');
});

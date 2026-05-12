import { useEffect, useState, useCallback, useMemo } from 'react';
import type {
  Person,
  Property,
  Vehicle,
  Card,
  Animal,
  Company,
  DocumentEntityLink,
} from '@/types';
import * as entities from '@/services/entities';
import { setGlobalOrder, getGlobalOrderMap, type EntityRef } from '@/services/entityOrder';
import { on } from '@/services/events';

export function useEntities() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [globalOrderMap, setGlobalOrderMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, pr, v, c, a, co, orderMap] = await Promise.all([
        entities.getPersons(),
        entities.getProperties(),
        entities.getVehicles(),
        entities.getCards(),
        entities.getAnimals(),
        entities.getCompanies(),
        getGlobalOrderMap(),
      ]);
      setPersons(p);
      setProperties(pr);
      setVehicles(v);
      setCards(c);
      setAnimals(a);
      setCompanies(co);
      setGlobalOrderMap(orderMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const off = on('entities:changed', () => {
      refresh().catch(() => {});
    });
    return off;
  }, [refresh]);

  // Aplică o nouă ordine globală peste toate entitățile vizibile.
  // UI-ul trimite lista completă reorderată (pentru tab-urile per-tip, UI-ul trebuie
  // să insereze elementele reorderate în sloturile lor originale din lista globală).
  const reorder = useCallback(
    async (newOrder: EntityRef[]) => {
      try {
        await setGlobalOrder(newOrder);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Eroare la salvarea ordinii');
      }
    },
    [refresh]
  );

  /**
   * Rezolvă numele unei entități referite printr-un link. Sursa unică de
   * lookup — folosit de UI peste tot ca să afișăm numele real în loc de ID.
   * Pentru carduri construim label compus (nickname+last4),
   * resp. nume + persoană proprietară).
   */
  const resolveEntityName = useMemo(() => {
    return (link: DocumentEntityLink): string => {
      switch (link.entityType) {
        case 'person':
          return persons.find(p => p.id === link.entityId)?.name ?? link.entityId;
        case 'vehicle':
          return vehicles.find(v => v.id === link.entityId)?.name ?? link.entityId;
        case 'property':
          return properties.find(p => p.id === link.entityId)?.name ?? link.entityId;
        case 'card': {
          const c = cards.find(card => card.id === link.entityId);
          return c ? `${c.nickname} ····${c.last4}` : link.entityId;
        }
        case 'animal':
          return animals.find(a => a.id === link.entityId)?.name ?? link.entityId;
        case 'company':
          return companies.find(c => c.id === link.entityId)?.name ?? link.entityId;
        default:
          return link.entityId;
      }
    };
  }, [persons, properties, vehicles, cards, animals, companies]);

  return {
    persons,
    properties,
    vehicles,
    cards,
    animals,
    companies,
    globalOrderMap,
    loading,
    error,
    refresh,
    reorder,
    resolveEntityName,
    createPerson: entities.createPerson,
    createProperty: entities.createProperty,
    createVehicle: entities.createVehicle,
    createCard: entities.createCard,
    createAnimal: entities.createAnimal,
    createCompany: entities.createCompany,
    deletePerson: entities.deletePerson,
    deleteProperty: entities.deleteProperty,
    deleteVehicle: entities.deleteVehicle,
    deleteCard: entities.deleteCard,
    deleteAnimal: entities.deleteAnimal,
    deleteCompany: entities.deleteCompany,
    updatePerson: entities.updatePerson,
    updateProperty: entities.updateProperty,
    updateVehicle: entities.updateVehicle,
    updateCard: entities.updateCard,
    updateAnimal: entities.updateAnimal,
    updateCompany: entities.updateCompany,
  };
}

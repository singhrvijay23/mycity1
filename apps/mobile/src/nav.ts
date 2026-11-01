import { createContext, useContext } from 'react';

export type Route =
  | { name: 'login' }
  | { name: 'home' }
  | { name: 'post'; categoryId?: number; text?: string }
  | { name: 'myLeads' }
  | { name: 'lead'; id: number }
  | { name: 'chat'; leadId: number; vendorId?: number; title: string }
  | { name: 'vendorLeads' }
  | { name: 'vendorLead'; id: number }
  | { name: 'wallet' };

export type Nav = { push: (r: Route) => void; back: () => void; reset: (r: Route) => void };
export const NavCtx = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(NavCtx);

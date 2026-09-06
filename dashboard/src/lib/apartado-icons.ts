import {
  PiggyBank, Wallet, Target, TrendingUp, Coins, Landmark, CreditCard,
  HandCoins, DollarSign, Banknote, Gem, Vault, CircleDollarSign, Home,
  PawPrint, PartyPopper, Palmtree, Baby, School, GraduationCap, ShoppingBag,
  type LucideIcon,
} from 'lucide-react'

// Set curado de iconos para elegir por Apartado (meta de ahorro): financieros
// de base mas unos tematicos para metas comunes (mascotas, diversion, playa,
// bebe, escuela, estudios, shopping). No existe resolucion dinamica de iconos
// por string en el proyecto -- se guarda el nombre-clave en Apartado.icono y
// se resuelve aqui contra este arreglo, en vez de importar lucide-react
// dinamicamente por nombre (mas fragil y sin tipos).
export const APARTADO_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'PiggyBank', Icon: PiggyBank },
  { name: 'Wallet', Icon: Wallet },
  { name: 'Target', Icon: Target },
  { name: 'TrendingUp', Icon: TrendingUp },
  { name: 'Coins', Icon: Coins },
  { name: 'Landmark', Icon: Landmark },
  { name: 'CreditCard', Icon: CreditCard },
  { name: 'HandCoins', Icon: HandCoins },
  { name: 'DollarSign', Icon: DollarSign },
  { name: 'Banknote', Icon: Banknote },
  { name: 'Gem', Icon: Gem },
  { name: 'Vault', Icon: Vault },
  { name: 'CircleDollarSign', Icon: CircleDollarSign },
  { name: 'Home', Icon: Home },
  { name: 'PawPrint', Icon: PawPrint },
  { name: 'PartyPopper', Icon: PartyPopper },
  { name: 'Palmtree', Icon: Palmtree },
  { name: 'Baby', Icon: Baby },
  { name: 'School', Icon: School },
  { name: 'GraduationCap', Icon: GraduationCap },
  { name: 'ShoppingBag', Icon: ShoppingBag },
]

const DEFAULT_ICON_NAME = 'PiggyBank'

export function resolveApartadoIcon(name?: string | null): LucideIcon {
  return APARTADO_ICONS.find(i => i.name === name)?.Icon ?? PiggyBank
}

export interface ApartadoColorClasses {
  /** clave guardada en Apartado.color */
  key: string
  /** swatch solido, para el boton del picker y la barra de progreso */
  swatch: string
  /** fondo suave del circulo de icono */
  badgeBg: string
  /** color del icono dentro del circulo */
  iconText: string
  /** color del monto/balance */
  text: string
}

// Paleta de swatches para elegir color por Apartado. Cada clase va escrita
// completa (no armada con template strings) porque Tailwind solo genera CSS
// para clases que aparecen literales en el codigo fuente.
export const APARTADO_COLORS: ApartadoColorClasses[] = [
  { key: 'blue', swatch: 'bg-blue-500', badgeBg: 'bg-blue-100 dark:bg-blue-900/30', iconText: 'text-blue-600 dark:text-blue-400', text: 'text-blue-700 dark:text-blue-400' },
  { key: 'orange', swatch: 'bg-orange-500', badgeBg: 'bg-orange-100 dark:bg-orange-900/30', iconText: 'text-orange-600 dark:text-orange-400', text: 'text-orange-700 dark:text-orange-400' },
  { key: 'rose', swatch: 'bg-rose-500', badgeBg: 'bg-rose-100 dark:bg-rose-900/30', iconText: 'text-rose-600 dark:text-rose-400', text: 'text-rose-700 dark:text-rose-400' },
  { key: 'sky', swatch: 'bg-sky-500', badgeBg: 'bg-sky-100 dark:bg-sky-900/30', iconText: 'text-sky-600 dark:text-sky-400', text: 'text-sky-700 dark:text-sky-400' },
  { key: 'violet', swatch: 'bg-violet-500', badgeBg: 'bg-violet-100 dark:bg-violet-900/30', iconText: 'text-violet-600 dark:text-violet-400', text: 'text-violet-700 dark:text-violet-400' },
  { key: 'emerald', swatch: 'bg-emerald-500', badgeBg: 'bg-emerald-100 dark:bg-emerald-900/30', iconText: 'text-emerald-600 dark:text-emerald-400', text: 'text-emerald-700 dark:text-emerald-400' },
  { key: 'amber', swatch: 'bg-amber-500', badgeBg: 'bg-amber-100 dark:bg-amber-900/30', iconText: 'text-amber-600 dark:text-amber-400', text: 'text-amber-700 dark:text-amber-400' },
  { key: 'indigo', swatch: 'bg-indigo-500', badgeBg: 'bg-indigo-100 dark:bg-indigo-900/30', iconText: 'text-indigo-600 dark:text-indigo-400', text: 'text-indigo-700 dark:text-indigo-400' },
  { key: 'teal', swatch: 'bg-teal-500', badgeBg: 'bg-teal-100 dark:bg-teal-900/30', iconText: 'text-teal-600 dark:text-teal-400', text: 'text-teal-700 dark:text-teal-400' },
  { key: 'slate', swatch: 'bg-slate-500', badgeBg: 'bg-slate-100 dark:bg-slate-700', iconText: 'text-slate-600 dark:text-slate-400', text: 'text-slate-700 dark:text-slate-300' },
]

const DEFAULT_COLOR_KEY = 'blue'

export function resolveApartadoColor(key?: string | null): ApartadoColorClasses {
  return APARTADO_COLORS.find(c => c.key === key) ?? APARTADO_COLORS[0]
}

export { DEFAULT_ICON_NAME, DEFAULT_COLOR_KEY }

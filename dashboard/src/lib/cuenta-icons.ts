import {
  Landmark, Wallet, Banknote, ShoppingBag, Fuel, TrendingUp, CircleDollarSign,
  CreditCard, PiggyBank, Coins, HandCoins, Vault, DollarSign, Gem, Smartphone,
  type LucideIcon,
} from 'lucide-react'

// Set curado de iconos para elegir por Cuenta (banco, efectivo, vales,
// inversión...). No existe resolución dinámica de iconos por string en el
// proyecto -- se guarda el nombre-clave en Cuenta.icono y se resuelve aquí
// contra este arreglo, igual que @/lib/apartado-icons.
export const CUENTA_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'Landmark', Icon: Landmark },
  { name: 'Wallet', Icon: Wallet },
  { name: 'Banknote', Icon: Banknote },
  { name: 'ShoppingBag', Icon: ShoppingBag },
  { name: 'Fuel', Icon: Fuel },
  { name: 'TrendingUp', Icon: TrendingUp },
  { name: 'CircleDollarSign', Icon: CircleDollarSign },
  { name: 'CreditCard', Icon: CreditCard },
  { name: 'PiggyBank', Icon: PiggyBank },
  { name: 'Coins', Icon: Coins },
  { name: 'HandCoins', Icon: HandCoins },
  { name: 'Vault', Icon: Vault },
  { name: 'DollarSign', Icon: DollarSign },
  { name: 'Gem', Icon: Gem },
  { name: 'Smartphone', Icon: Smartphone },
]

const DEFAULT_ICON_NAME = 'Wallet'

export function resolveCuentaIcon(name?: string | null): LucideIcon {
  return CUENTA_ICONS.find(i => i.name === name)?.Icon ?? Wallet
}

export interface CuentaColorClasses {
  /** clave guardada en Cuenta.color */
  key: string
  /** swatch solido, para el boton del picker */
  swatch: string
  /** fondo suave del circulo de icono */
  badgeBg: string
  /** color del icono dentro del circulo */
  iconText: string
  /** color del monto/texto asociado */
  text: string
}

// Paleta de swatches para elegir color por Cuenta. Cada clase va escrita
// completa (no armada con template strings) porque Tailwind solo genera CSS
// para clases que aparecen literales en el codigo fuente.
export const CUENTA_COLORS: CuentaColorClasses[] = [
  { key: 'blue', swatch: 'bg-blue-500', badgeBg: 'bg-blue-100 dark:bg-blue-900/30', iconText: 'text-blue-600 dark:text-blue-400', text: 'text-blue-700 dark:text-blue-400' },
  { key: 'rose', swatch: 'bg-rose-500', badgeBg: 'bg-rose-100 dark:bg-rose-900/30', iconText: 'text-rose-600 dark:text-rose-400', text: 'text-rose-700 dark:text-rose-400' },
  { key: 'violet', swatch: 'bg-violet-500', badgeBg: 'bg-violet-100 dark:bg-violet-900/30', iconText: 'text-violet-600 dark:text-violet-400', text: 'text-violet-700 dark:text-violet-400' },
  { key: 'emerald', swatch: 'bg-emerald-500', badgeBg: 'bg-emerald-100 dark:bg-emerald-900/30', iconText: 'text-emerald-600 dark:text-emerald-400', text: 'text-emerald-700 dark:text-emerald-400' },
  { key: 'teal', swatch: 'bg-teal-500', badgeBg: 'bg-teal-100 dark:bg-teal-900/30', iconText: 'text-teal-600 dark:text-teal-400', text: 'text-teal-700 dark:text-teal-400' },
  { key: 'amber', swatch: 'bg-amber-500', badgeBg: 'bg-amber-100 dark:bg-amber-900/30', iconText: 'text-amber-600 dark:text-amber-400', text: 'text-amber-700 dark:text-amber-400' },
  { key: 'orange', swatch: 'bg-orange-500', badgeBg: 'bg-orange-100 dark:bg-orange-900/30', iconText: 'text-orange-600 dark:text-orange-400', text: 'text-orange-700 dark:text-orange-400' },
  { key: 'sky', swatch: 'bg-sky-500', badgeBg: 'bg-sky-100 dark:bg-sky-900/30', iconText: 'text-sky-600 dark:text-sky-400', text: 'text-sky-700 dark:text-sky-400' },
  { key: 'indigo', swatch: 'bg-indigo-500', badgeBg: 'bg-indigo-100 dark:bg-indigo-900/30', iconText: 'text-indigo-600 dark:text-indigo-400', text: 'text-indigo-700 dark:text-indigo-400' },
  { key: 'slate', swatch: 'bg-slate-500', badgeBg: 'bg-slate-100 dark:bg-slate-700', iconText: 'text-slate-600 dark:text-slate-400', text: 'text-slate-700 dark:text-slate-300' },
]

const DEFAULT_COLOR_KEY = 'blue'

export function resolveCuentaColor(key?: string | null): CuentaColorClasses {
  return CUENTA_COLORS.find(c => c.key === key) ?? CUENTA_COLORS[0]
}

// Tipos de cuenta ofrecidos en el selector de Configuración > Cuentas. El
// campo Cuenta.tipo es texto libre en DB (compatibilidad con datos viejos
// como 'Banco'/'Digital'), pero la UI solo permite elegir de este set.
export const TIPOS_CUENTA = ['Debito', 'Credito', 'Efectivo', 'Vales', 'Inversion', 'Otro'] as const
export type TipoCuenta = (typeof TIPOS_CUENTA)[number]

export const TIPO_CUENTA_LABEL: Record<TipoCuenta, string> = {
  Debito: 'Débito',
  Credito: 'Crédito',
  Efectivo: 'Efectivo',
  Vales: 'Vales',
  Inversion: 'Inversión',
  Otro: 'Otro',
}

export { DEFAULT_ICON_NAME, DEFAULT_COLOR_KEY }

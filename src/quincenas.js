// Tabla oficial de quincenas (Fase 0).
// Fuente: hoja "semanas" del Excel milo_tracker_v6.xlsm.
// - Q23-Q24: historicas, inferidas del historial de la hoja "Captura" (no estan en "semanas").
// - Q25-Q36: oficiales, copiadas textualmente de la hoja "semanas".
// - Q37-Q42: proyectadas siguiendo el patron de dias de pago; pendientes de validar.
// Los rangos siguen dias reales de pago, por lo que existen fechas sin quincena
// (ej. 2026-05-14). Una fecha fuera de todo rango se reporta como "Sin quincena".
const QUINCENAS = [
  { codigo: 'Q23', inicio: '2026-03-01', fin: '2026-03-29' },
  { codigo: 'Q24', inicio: '2026-03-30', fin: '2026-04-14' },
  { codigo: 'Q25', inicio: '2026-04-15', fin: '2026-04-29' },
  { codigo: 'Q26', inicio: '2026-04-30', fin: '2026-05-13' },
  { codigo: 'Q27', inicio: '2026-05-15', fin: '2026-05-28' },
  { codigo: 'Q28', inicio: '2026-05-29', fin: '2026-06-14' },
  { codigo: 'Q29', inicio: '2026-06-15', fin: '2026-06-29' },
  { codigo: 'Q30', inicio: '2026-06-30', fin: '2026-07-14' },
  { codigo: 'Q31', inicio: '2026-07-15', fin: '2026-07-29' },
  { codigo: 'Q32', inicio: '2026-07-30', fin: '2026-08-13' },
  // Q33+: los cierres de fin de mes usan la regla de último día hábil
  // (ver lastBusinessDayOfMonth) en vez de una fecha fija de tabla; los
  // cierres de mediados de mes siguen siendo fijos, sin fórmula.
  { codigo: 'Q33', inicio: '2026-08-14', fin: '2026-08-31' },
  { codigo: 'Q34', inicio: '2026-09-01', fin: '2026-09-14' },
  { codigo: 'Q35', inicio: '2026-09-15', fin: '2026-09-30' },
  { codigo: 'Q36', inicio: '2026-10-01', fin: '2026-10-14' },
  { codigo: 'Q37', inicio: '2026-10-15', fin: '2026-10-30' },
  { codigo: 'Q38', inicio: '2026-10-31', fin: '2026-11-12' },
  { codigo: 'Q39', inicio: '2026-11-13', fin: '2026-11-30' },
  { codigo: 'Q40', inicio: '2026-12-01', fin: '2026-12-14' },
  { codigo: 'Q41', inicio: '2026-12-15', fin: '2026-12-31' },
  { codigo: 'Q42', inicio: '2027-01-01', fin: '2027-01-14' },
];

const SIN_QUINCENA = 'Sin quincena';

function getQuincenaForDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const iso = `${y}-${m}-${d}`;
  const q = QUINCENAS.find(q => iso >= q.inicio && iso <= q.fin);
  return q ? q.codigo : SIN_QUINCENA;
}

function getCurrentQuincena(date) {
  return getQuincenaForDate(date || new Date());
}

// Último día hábil del mes (salta sábado/domingo, sin calendario de festivos).
// Usado solo para los cierres de quincena de fin de mes (Q33+), ver arriba.
function lastBusinessDayOfMonth(year, monthIndex0) {
  const d = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  const day = d.getUTCDay();
  if (day === 0) d.setUTCDate(d.getUTCDate() - 2); // domingo -> viernes
  else if (day === 6) d.setUTCDate(d.getUTCDate() - 1); // sábado -> viernes
  return d;
}

module.exports = { QUINCENAS, SIN_QUINCENA, getQuincenaForDate, getCurrentQuincena, lastBusinessDayOfMonth };

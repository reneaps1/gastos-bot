# Política De Desarrollo - Milo Gastos App

Este documento define la dirección técnica y funcional del proyecto. Debe leerse antes de iniciar cualquier cambio relevante en el sistema.

## Objetivo

Convertir el sistema actual de control de gastos, basado en Excel + Google Sheets + bot de WhatsApp, en una aplicación robusta con:

- Base de datos relacional sólida.
- Dashboard web.
- Administración de gastos, ingresos, presupuestos, deudas y liquidez.
- Integración con WhatsApp.
- Migración ordenada desde Excel y Google Sheets.
- Reglas claras para mantener consistencia financiera.

## Estado Actual

El proyecto actual contiene:

- Bot Node.js/Express.
- Webhook de WhatsApp usando Meta API.
- Registro de gastos en Google Sheets.
- Parser básico de mensajes.
- Analytics simples desde Google Sheets.
- Archivo Excel `milo_tracker_v6.xlsm` con lógica financiera avanzada.
- Documento inicial `ddl_plan.md`.

El bot actualmente escribe en `Sheet1!A:K`.

Columnas actuales aproximadas:

- Timestamp
- Usuario
- Monto
- Descripción
- Categoría
- Forma de pago
- Tipo
- Clasificación
- Quincena
- Estatus
- Fecha

## Problema Principal Actual

Google Sheets funciona como prototipo, pero no como fuente robusta de verdad.

Problemas detectados:

- No hay base de datos formal.
- No hay constraints.
- No hay relaciones entre entidades.
- No hay migraciones.
- No hay frontend.
- No hay autenticación real.
- No hay API interna estable.
- No hay tests.
- El cálculo de quincena del bot no coincide con el Excel.
- El bot genera quincenas como `Q11`, mientras el Excel usa secuencia financiera como `Q25`, `Q26`, `Q27`, `Q28`.

## Principio Rector

La fuente oficial del sistema debe ser PostgreSQL.

Google Sheets puede seguir existiendo como:

- Respaldo.
- Exportación.
- Vista auxiliar.
- Herramienta temporal durante transición.

Pero no debe ser la fuente principal de verdad para el sistema final.

## Arquitectura Objetivo

Flujo objetivo:

```text
WhatsApp Bot
     ↓
Backend/API
     ↓
PostgreSQL
     ↓
Dashboard Web
```

Componentes objetivo:

- Aplicación web.
- API interna.
- Base PostgreSQL.
- Bot de WhatsApp.
- Importador desde Excel.
- Importador/exportador Google Sheets.
- Dashboard financiero.
- Panel administrativo.

## Stack Recomendado

Stack preferido:

- Next.js
- PostgreSQL
- Prisma
- Tailwind CSS
- shadcn/ui
- WhatsApp Cloud API
- Google Sheets API como integración secundaria

Alternativa aceptable:

- Express backend existente
- PostgreSQL
- Prisma o Drizzle
- Frontend React/Vite separado

La recomendación oficial es usar Next.js full-stack para reducir complejidad inicial.

## Fases Del Proyecto

### Fase 0: Alinear Reglas Del Negocio

Explicación simple:

Antes de construir la app, se define qué significa cada cosa. Es como acordar las reglas del juego.

Objetivos:

- Definir cómo funcionan las quincenas.
- Confirmar secuencia oficial: `Q25`, `Q26`, `Q27`, etc.
- Confirmar categorías oficiales.
- Confirmar usuarios del sistema.
- Decidir si Google Sheets queda como respaldo.
- Decidir si Excel será fuente histórica inicial.
- Documentar reglas de negocio.

Entregables:

- Reglas oficiales de quincenas.
- Catálogo oficial de categorías.
- Catálogo inicial de usuarios.
- Decisión sobre Sheets.
- Decisión sobre Excel histórico.

### Catálogo Oficial de Categorías (Fase 0 - Cerrado)

Las categorías del sistema son las del Excel `milo_tracker_v6.xlsm`. No usar categorías externas.

| Categoría     | Tipo     | Clasificación | Ejemplos                                              |
|---------------|----------|---------------|--------------------------------------------------------|
| Hogar         | Gasto    | Fijo          | Renta, Agua, Luz, Gas, Internet                       |
| Salud         | Gasto    | Fijo          | Medicamentos, Terapia, Pediatra, Gine, Tradea         |
| Familia       | Gasto    | Variable      | Super, Pañales, Niñera, Guardería, Croquetas, Fórmula |
| Transporte    | Gasto    | Variable      | Gasolina, Gas auto, Casetas, Control vehicular         |
| Suscripciones | Gasto    | Fijo          | Netflix, Spotify, Disney+, YouTube, ChatGPT, Claude   |
| Deudas        | Gasto    | Fijo          | Préstamos, Coppel, Tanda, Kueski, Pago truck          |
| Personal      | Gasto    | Variable      | Diversión, Yoga, GYM, Audífonos, Educación, Ropa      |
| Ingresos      | Ingreso  | NULL          | Salario, Vales, Bono, Prima, Anticipo                  |
| Ahorro        | Ahorro   | NULL          | Fondo emergencia, Meta vacaciones, Ahorro pareja       |

Reglas:
- No existe "Otros" como categoría. Todo debe clasificarse en una de estas 9.
- "Comida" y "Super" van en **Familia**.
- "Diversion", "Ropa" y "Educación" van en **Personal**.
- "Audífonos", "Fórmula Leo", "Medicina Mariana" van en **Personal**.
- "Coppel", "Abono deuda", "Pago truck" van en **Deudas**.

### Fase 1: DDL Final Y Base De Datos

Explicación simple:

Aquí se diseña la estructura donde vivirá la información. Es convertir el Excel en una base ordenada y protegida.

Objetivos:

- Revisar y mejorar `ddl_plan.md`.
- Diseñar modelo final PostgreSQL.
- Crear tablas principales.
- Crear relaciones y constraints.
- Crear vistas para dashboard.
- Preparar migraciones.

Tablas base recomendadas:

- `users`
- `households`
- `quincenas`
- `categorias`
- `conceptos`
- `metodos_pago`
- `cuentas`
- `transacciones`
- `presupuestos`
- `deudas`
- `deuda_abonos`
- `liquidez_snapshots`
- `whatsapp_messages`
- `import_batches`
- `audit_log`

Entregables:

- DDL final.
- Migración inicial.
- Seeds iniciales.
- Vistas SQL para dashboard.

### Fase 2: Setup Técnico De La App

Explicación simple:

Aquí se monta la base técnica de la aplicación web.

Objetivos:

- Crear estructura de app.
- Configurar PostgreSQL.
- Configurar Prisma.
- Configurar variables de entorno.
- Crear migraciones.
- Mantener bot actual operativo mientras se migra.

Entregables:

- Proyecto listo para app web.
- DB conectada.
- Migraciones funcionando.
- Scripts básicos de desarrollo.

### Fase 3: Migración De Datos

Explicación simple:

Aquí se pasan los datos actuales del Excel y Google Sheets al nuevo sistema.

Fuentes:

- `milo_tracker_v6.xlsm`
- Google Sheets actual

Hojas importantes del Excel:

- `Captura`
- `Registro`
- `Presupuesto`
- `Liquidez`
- `Deudas v2`
- `Categorias`
- `semanas`

Objetivos:

- Importar historial.
- Normalizar categorías.
- Normalizar conceptos.
- Corregir quincenas.
- Detectar registros inválidos.
- Validar totales contra Excel.

Validaciones iniciales:

- Q24 ingresos, gastos y balance.
- Q25 ingresos, gastos y balance.
- Estado de deudas contra `Deudas v2`.
- Presupuesto vs gastado por quincena.

Entregables:

- Script de importación.
- Reporte de migración.
- Lista de registros problemáticos.
- Datos históricos en PostgreSQL.

### Fase 4: Refactor Del Bot

Explicación simple:

El bot dejará de guardar en Google Sheets como fuente principal y empezará a guardar en la base real.

Objetivos:

- Separar lógica del bot.
- Corregir cálculo de quincena.
- Guardar mensajes recibidos.
- Guardar transacciones en PostgreSQL.
- Mantener export opcional a Sheets.
- Mejorar parser.
- Asociar movimientos a usuario, categoría, concepto y método de pago.

Módulos recomendados:

- `whatsapp`
- `parser`
- `classifier`
- `transactions`
- `analytics`
- `sheets-export`
- `database`

Entregables:

- Bot conectado a DB.
- Registro confiable de transacciones.
- Historial de mensajes WhatsApp.
- Sheets opcional como backup/export.

### Fase 5: API Interna

Explicación simple:

Aquí se crean los conectores que usará el dashboard para leer y modificar datos.

Endpoints objetivo:

- Dashboard quincenal.
- Transacciones.
- Presupuestos.
- Categorías.
- Conceptos.
- Deudas.
- Liquidez.
- Usuarios.
- Métodos de pago.
- Cuentas.

Filtros requeridos:

- Quincena.
- Fecha.
- Categoría.
- Usuario.
- Tipo.
- Estatus.
- Método de pago.

Entregables:

- API interna estable.
- Validaciones.
- Manejo de errores.
- Queries listas para frontend.

### Fase 6: Dashboard MVP

Explicación simple:

Aquí se crea la primera versión web de lo que hoy ves en Excel.

Debe mostrar:

- Ingresos de quincena.
- Presupuesto total.
- Gastado real.
- Pendiente por pagar.
- Líquido real.
- Margen.
- Semáforo financiero.
- Avance por concepto.
- Lista de gastos pendientes.
- Últimos movimientos.
- Gastos por categoría.
- Selector de quincena.

Requisitos:

- Responsive desktop/mobile.
- Visualmente claro.
- Basado en la lógica real del Excel.
- Sin inventar métricas que no estén validadas.

Entregables:

- Dashboard funcional.
- Vista por quincena.
- KPIs principales.
- Gráficas básicas.

### Fase 7: Administración

Explicación simple:

Aquí se reemplaza la edición manual del Excel por pantallas web.

Pantallas objetivo:

- Transacciones.
- Presupuesto por quincena.
- Conceptos recurrentes.
- Categorías.
- Deudas.
- Liquidez.
- Usuarios.
- Corrección de movimientos del bot.

Acciones necesarias:

- Crear.
- Editar.
- Eliminar.
- Filtrar.
- Validar.
- Auditar cambios importantes.

Entregables:

- Panel administrativo.
- CRUD de entidades principales.
- Corrección manual de registros.
- Menor dependencia del Excel.

### Fase 8: Inteligencia Y Automatización

Explicación simple:

Aquí el sistema empieza a ayudar activamente, no solo a guardar información.

Objetivos:

- Alertas por WhatsApp.
- Proyección de cierre de quincena.
- Comparativo contra quincenas anteriores.
- Reglas automáticas de categorización.
- Sugerencias de corrección.
- Detección de sobregiros.
- Detección de gastos recurrentes.
- Exportaciones a Excel/Sheets.

Ejemplos:

- "Vas pasado en Diversión."
- "Falta pagar Guardería."
- "Tu margen real bajó de $1,000."
- "Este gasto parece Super, ¿lo confirmo?"
- "Proyección: cerrarías la quincena en negativo."

Entregables:

- Sistema de alertas.
- Reglas automáticas.
- Resúmenes inteligentes.
- Bot más útil.

## Orden Oficial De Ejecución

El orden recomendado es:

1. Fase 0: Reglas oficiales.
2. Fase 1: DDL final.
3. Fase 2: Setup app + DB.
4. Fase 3: Migración.
5. Fase 4: Bot conectado a DB.
6. Fase 5: API.
7. Fase 6: Dashboard MVP.
8. Fase 7: Administración.
9. Fase 8: Automatización.

## Reglas De Desarrollo

### No Construir Dashboard Sin Modelo

No se debe construir dashboard final antes de cerrar:

- Quincenas.
- Categorías.
- Conceptos.
- Transacciones.
- Presupuesto.
- Deudas.
- Liquidez.

Motivo:

Un dashboard sobre datos mal modelados muestra números incorrectos.

### PostgreSQL Es Fuente Oficial

Toda lógica robusta debe apuntar a PostgreSQL.

Google Sheets no debe ser usado como fuente definitiva en la app final.

### El Excel Es Referencia De Negocio

El Excel `milo_tracker_v6.xlsm` debe usarse como referencia funcional.

La app debe replicar primero la lógica importante del Excel antes de agregar funcionalidades nuevas.

### Migración Con Validación

Toda migración debe validar totales contra el Excel.

Validaciones mínimas:

- Ingresos por quincena.
- Gastos por quincena.
- Balance.
- Presupuesto vs pagado.
- Estado de deudas.
- Liquidez.

### Bot Y Dashboard Deben Compartir DB

El bot no debe tener una fuente de datos distinta al dashboard.

Toda transacción creada por WhatsApp debe verse en la app.

Toda corrección hecha en la app debe afectar analytics del bot.

### Cambios Financieros Deben Ser Auditables

Cambios importantes deben guardar auditoría:

- Transacciones editadas.
- Transacciones eliminadas.
- Presupuestos modificados.
- Deudas modificadas.
- Cortes de liquidez modificados.

## Riesgos Conocidos

- Quincenas mal calculadas.
- Categorías inconsistentes entre Excel, bot y Sheets.
- Descripciones duplicadas o ambiguas.
- Deudas registradas solo por texto en notas.
- Sheets con registros inválidos como `#REF!`.
- Historial repartido entre Excel, Sheets y bot.
- Parser actual demasiado simple.
- Falta de autenticación para app web.
- Falta de pruebas automatizadas.

## Decisiones Pendientes

Antes de implementar la app final se debe decidir:

1. ¿Google Sheets seguirá como backup o se elimina del flujo?
2. ¿La app será solo para una persona o multiusuario?
3. ¿Dónde se desplegará?
4. ¿Se usará Next.js full-stack o Express + frontend separado?
5. ¿Se importará todo el Excel o solo desde cierta fecha?
6. ¿Qué nombres oficiales tendrán las categorías?
7. ¿Qué nombres oficiales tendrán los usuarios?
8. ¿Cómo se manejarán gastos compartidos?
9. ¿Cómo se manejarán transferencias entre cuentas?
10. ¿Cómo se manejarán pagos parciales de deudas?

## Próximo Paso Recomendado

El siguiente paso oficial es ejecutar Fase 0 y Fase 1:

1. Corregir la definición de quincenas.
2. Cerrar catálogo oficial de categorías.
3. Cerrar modelo final de datos.
4. Convertir `ddl_plan.md` en migraciones reales.
5. Preparar migración desde Excel y Google Sheets.

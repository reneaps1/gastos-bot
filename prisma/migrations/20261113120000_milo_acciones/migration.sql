-- Acciones que el agente de Milo PROPONE en Telegram y que solo se ejecutan
-- cuando el usuario toca "Confirmar" (src/miloAcciones.js).
--
-- Por que una tabla y no el boton: una accion completa (que movimiento, que
-- campos, que valores) no cabe en los 64 bytes de callback_data. El boton
-- lleva solo `ax:<id>`; lo que se ejecuta es lo que quedo guardado aqui, que
-- es exactamente lo que el usuario vio en `resumen`. La IA nunca escribe datos
-- financieros: solo deja una fila `pendiente`.
--
-- `estado`: pendiente -> ejecutando -> ejecutada | fallida; o cancelada /
-- expirada. El paso pendiente -> ejecutando es un UPDATE condicional, asi que
-- dos toques del mismo boton no ejecutan dos veces.
--
-- Tabla NUEVA y aditiva. IF NOT EXISTS porque dos historias de migraciones
-- (raiz y dashboard/) corren contra la misma base.
CREATE TABLE IF NOT EXISTS "milo_acciones" (
  "id" SERIAL NOT NULL,
  "chat_id" VARCHAR(40) NOT NULL,
  "user_id" INTEGER,
  "solicitante" VARCHAR(60),
  "tipo" VARCHAR(40) NOT NULL,
  "payload" JSONB NOT NULL,
  "resumen" TEXT NOT NULL,
  "estado" VARCHAR(15) NOT NULL DEFAULT 'pendiente',
  "resultado" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expira_en" TIMESTAMPTZ NOT NULL,
  "ejecutada_en" TIMESTAMPTZ,

  CONSTRAINT "milo_acciones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_milo_acciones_chat_estado"
  ON "milo_acciones" ("chat_id", "estado");

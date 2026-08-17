-- Pregunta "a que linea de presupuesto" pendiente de respuesta del atajo
-- rapido de WhatsApp (ej. "930, 3B"). Como mucho una fila abierta por
-- telefono (UNIQUE en "phone"); se borra al responderse, reemplazarse o
-- expirar -- no hay worker/cron que la barra sola, se checa "expires_at" al
-- leer.

CREATE TABLE "pending_expenses" (
  "id" SERIAL NOT NULL,
  "phone" VARCHAR(20) NOT NULL,
  "user_id" INTEGER,
  "sender_name" VARCHAR(100),
  "original_message_id" VARCHAR(100),
  "raw_text" TEXT NOT NULL,
  "fecha" DATE NOT NULL,
  "descripcion" VARCHAR(200) NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL,
  "forma_pago" VARCHAR(30) NOT NULL,
  "metodo_pago_id" INTEGER,
  "estatus" "EstatusPago" NOT NULL,
  "quincena_id" INTEGER NOT NULL,
  "quincena_codigo" VARCHAR(5) NOT NULL,
  "source" VARCHAR(20) NOT NULL,
  "opciones" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "pending_expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pending_expenses_phone_key" UNIQUE ("phone"),
  CONSTRAINT "pending_expenses_monto_check" CHECK ("monto" > 0)
);

ALTER TABLE "pending_expenses" ADD CONSTRAINT "pending_expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pending_expenses" ADD CONSTRAINT "pending_expenses_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "metodos_pago"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pending_expenses" ADD CONSTRAINT "pending_expenses_quincena_id_fkey" FOREIGN KEY ("quincena_id") REFERENCES "quincenas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

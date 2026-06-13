-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('Gasto', 'Ingreso', 'Ahorro');

-- CreateEnum
CREATE TYPE "ClasificacionGasto" AS ENUM ('Fijo', 'Variable');

-- CreateEnum
CREATE TYPE "EstatusPago" AS ENUM ('Pagado', 'Pendiente');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(50) NOT NULL,
    "phone_whatsapp" VARCHAR(20),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_registro" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(50) NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "clasificacion" "ClasificacionGasto",
    "ejemplos" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metodos_pago" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(30) NOT NULL,

    CONSTRAINT "metodos_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quincenas" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(5) NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,

    CONSTRAINT "quincenas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuentas" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(50) NOT NULL,
    "tipo" VARCHAR(30),

    CONSTRAINT "cuentas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transacciones" (
    "id" SERIAL NOT NULL,
    "fecha" DATE NOT NULL,
    "quincena_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "descripcion" VARCHAR(200) NOT NULL,
    "categoria_id" INTEGER NOT NULL,
    "clasificacion" "ClasificacionGasto",
    "tipo" "TipoMovimiento" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "metodo_pago_id" INTEGER,
    "estatus" "EstatusPago" NOT NULL DEFAULT 'Pendiente',
    "notas" TEXT,
    "source" VARCHAR(20) DEFAULT 'whatsapp',
    "fecha_registro" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transacciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrada_rapida" (
    "id" SERIAL NOT NULL,
    "fecha" DATE NOT NULL,
    "descripcion" VARCHAR(200) NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "categoria_id" INTEGER,
    "tipo" "TipoMovimiento",
    "quincena_id" INTEGER,
    "notas" TEXT,
    "procesado" BOOLEAN NOT NULL DEFAULT false,
    "transaccion_id" INTEGER,
    "fecha_registro" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entrada_rapida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presupuesto" (
    "id" SERIAL NOT NULL,
    "quincena_id" INTEGER NOT NULL,
    "descripcion" VARCHAR(200) NOT NULL,
    "categoria_id" INTEGER NOT NULL,
    "clasificacion" "ClasificacionGasto",
    "tipo" "TipoMovimiento" NOT NULL,
    "monto_presupuestado" DECIMAL(12,2) NOT NULL,
    "notas" TEXT,
    "fecha_registro" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presupuesto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deudas" (
    "id" SERIAL NOT NULL,
    "acreedor" VARCHAR(100) NOT NULL,
    "deuda_original" DECIMAL(12,2) NOT NULL,
    "abono_mensual" DECIMAL(12,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "notas" TEXT,
    "fecha_inicio" DATE,
    "fecha_registro" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deudas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" SERIAL NOT NULL,
    "wa_message_id" VARCHAR(100),
    "from_number" VARCHAR(20) NOT NULL,
    "from_name" VARCHAR(100),
    "user_id" INTEGER,
    "body" TEXT NOT NULL,
    "tipo" VARCHAR(20),
    "procesado" BOOLEAN NOT NULL DEFAULT false,
    "transaccion_id" INTEGER,
    "error" TEXT,
    "fecha_mensaje" TIMESTAMPTZ NOT NULL,
    "fecha_registro" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" SERIAL NOT NULL,
    "fuente" VARCHAR(30) NOT NULL,
    "archivo" VARCHAR(200),
    "total_filas" INTEGER NOT NULL DEFAULT 0,
    "importadas" INTEGER NOT NULL DEFAULT 0,
    "rechazadas" INTEGER NOT NULL DEFAULT 0,
    "errores" TEXT,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    "fecha_inicio" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_fin" TIMESTAMPTZ,
    "usuario_id" INTEGER,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "tabla" VARCHAR(50) NOT NULL,
    "registro_id" INTEGER NOT NULL,
    "operacion" VARCHAR(10) NOT NULL,
    "campo" VARCHAR(50),
    "valor_anterior" TEXT,
    "valor_nuevo" TEXT,
    "user_id" INTEGER,
    "source" VARCHAR(20),
    "fecha" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidez_snapshots" (
    "id" SERIAL NOT NULL,
    "fecha_corte" TIMESTAMPTZ NOT NULL,
    "quincena_id" INTEGER NOT NULL,
    "bbva" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "banamex" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "uala" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "uala_inversion" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "efectivo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vales_despensa" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vales_gasolina" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "falta_pagar" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "teorico" DECIMAL(12,2),
    "notas" TEXT,
    "validado" BOOLEAN NOT NULL DEFAULT false,
    "fecha_registro" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidez_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_nombre_key" ON "users"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_whatsapp_key" ON "users"("phone_whatsapp");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_nombre_key" ON "categorias"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "metodos_pago_nombre_key" ON "metodos_pago"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "quincenas_codigo_key" ON "quincenas"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_nombre_key" ON "cuentas"("nombre");

-- CreateIndex
CREATE INDEX "idx_tx_quincena" ON "transacciones"("quincena_id");

-- CreateIndex
CREATE INDEX "idx_tx_categoria" ON "transacciones"("categoria_id");

-- CreateIndex
CREATE INDEX "idx_tx_fecha" ON "transacciones"("fecha");

-- CreateIndex
CREATE INDEX "idx_tx_tipo" ON "transacciones"("tipo");

-- CreateIndex
CREATE INDEX "idx_presupuesto_quincena" ON "presupuesto"("quincena_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_wa_message_id_key" ON "whatsapp_messages"("wa_message_id");

-- CreateIndex
CREATE INDEX "idx_wa_from" ON "whatsapp_messages"("from_number");

-- CreateIndex
CREATE INDEX "idx_wa_fecha" ON "whatsapp_messages"("fecha_mensaje");

-- CreateIndex
CREATE INDEX "idx_wa_user" ON "whatsapp_messages"("user_id");

-- CreateIndex
CREATE INDEX "idx_audit_tabla" ON "audit_log"("tabla", "registro_id");

-- CreateIndex
CREATE INDEX "idx_audit_fecha" ON "audit_log"("fecha");

-- CreateIndex
CREATE INDEX "idx_liquidez_quincena" ON "liquidez_snapshots"("quincena_id");

-- AddForeignKey
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_quincena_id_fkey" FOREIGN KEY ("quincena_id") REFERENCES "quincenas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "metodos_pago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_rapida" ADD CONSTRAINT "entrada_rapida_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_rapida" ADD CONSTRAINT "entrada_rapida_quincena_id_fkey" FOREIGN KEY ("quincena_id") REFERENCES "quincenas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_rapida" ADD CONSTRAINT "entrada_rapida_transaccion_id_fkey" FOREIGN KEY ("transaccion_id") REFERENCES "transacciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto" ADD CONSTRAINT "presupuesto_quincena_id_fkey" FOREIGN KEY ("quincena_id") REFERENCES "quincenas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto" ADD CONSTRAINT "presupuesto_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_transaccion_id_fkey" FOREIGN KEY ("transaccion_id") REFERENCES "transacciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidez_snapshots" ADD CONSTRAINT "liquidez_snapshots_quincena_id_fkey" FOREIGN KEY ("quincena_id") REFERENCES "quincenas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

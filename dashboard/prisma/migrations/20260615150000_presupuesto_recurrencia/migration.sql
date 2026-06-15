ALTER TABLE "presupuestos"
  ADD COLUMN "recurrente"           BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN "frecuencia"           VARCHAR(20),
  ADD COLUMN "recurrencia_grupo_id" VARCHAR(36),
  ADD COLUMN "num_ocurrencias"      INTEGER;

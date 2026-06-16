-- AlterTable
ALTER TABLE "transacciones" ADD COLUMN "presupuesto_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_tx_presupuesto" ON "transacciones"("presupuesto_id");

-- AddForeignKey
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_presupuesto_id_fkey" FOREIGN KEY ("presupuesto_id") REFERENCES "presupuesto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

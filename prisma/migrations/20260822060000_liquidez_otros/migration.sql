-- "Otros": catch-all para dinero en una cuenta/fuente que no se quiere
-- formalizar como columna fija, ya que la fuente puede variar de snapshot a
-- snapshot. Se captura como monto + nota corta (no solo un numero suelto)
-- para saber a que corresponde cuando se revise despues.
ALTER TABLE "liquidez_snapshots" ADD COLUMN "otros" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "liquidez_snapshots" ADD COLUMN "otros_nota" TEXT;

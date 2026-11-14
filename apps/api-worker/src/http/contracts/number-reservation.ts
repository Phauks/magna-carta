import { z } from "@hono/zod-openapi";

// The draft number a create panel holds (POST /api/v1/number-reservations), carried by the create
// request so the record is saved under exactly the number the panel showed. Where the hold is no
// longer this record's scope, the save takes the next free number instead.
export const numberReservationField = z
  .string()
  .min(1)
  .max(100)
  .optional()
  .openapi({
    description:
      "The draft number the create panel holds (POST /api/v1/number-reservations). Where the " +
      "hold is still this record's scope, the record is saved under exactly that number.",
  });

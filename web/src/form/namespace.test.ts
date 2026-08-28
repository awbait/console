import { describe, expect, it } from "bun:test";
import { orderNamespace } from "./namespace";

describe("orderNamespace", () => {
  it("takes the stored namespace when the order has one", () => {
    expect(orderNamespace({ namespace: "payments", service_name: "billing" })).toBe("payments");
  });

  it("falls back to the service name, as the backend does", () => {
    expect(orderNamespace({ namespace: "", service_name: "billing" })).toBe("billing");
  });
});

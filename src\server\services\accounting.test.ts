import { describe, expect, it } from "vitest";
import { assertBalanced } from "./accounting";
describe("double-entry accounting",()=>{
  it("accepts balanced entries",()=>expect(()=>assertBalanced([{accountCode:"1000",debit:"100",credit:"0"},{accountCode:"4000",debit:"0",credit:"100"}])).not.toThrow());
  it("rejects unbalanced entries",()=>expect(()=>assertBalanced([{accountCode:"1000",debit:"100",credit:"0"}])).toThrow("must balance"));
});

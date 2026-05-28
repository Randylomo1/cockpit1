/**
 * DBot XML strategy generator — DIGIT MATCH only.
 *
 * Produces a lightweight Blockly XML compatible with dbot.deriv.com.
 * The generated file pre-fills market, contract type (DIGITMATCH),
 * duration (1 tick), stake, and a placeholder for the prediction digit
 * (the user enters the digit recommended by the analysis engine).
 */
import type { MarketSymbol } from "../deriv/markets";

export interface DbotTemplateInput {
  market: MarketSymbol;
  digit: number;       // recommended MATCH digit (0..9)
  stake: number;       // initial stake (USD)
  durationTicks?: number; // default 1
}

const SYMBOL_TO_DBOT: Record<MarketSymbol, string> = {
  R_10: "R_10", R_25: "R_25", R_50: "R_50", R_75: "R_75", R_100: "R_100",
  "1HZ10V": "1HZ10V", "1HZ25V": "1HZ25V", "1HZ50V": "1HZ50V",
  "1HZ75V": "1HZ75V", "1HZ100V": "1HZ100V",
  BOOM500: "BOOM500", BOOM1000: "BOOM1000",
  CRASH500: "CRASH500", CRASH1000: "CRASH1000",
};

const MARKET_GROUP: Record<MarketSymbol, { market: string; submarket: string }> = {
  R_10:  { market: "synthetic_index", submarket: "random_index" },
  R_25:  { market: "synthetic_index", submarket: "random_index" },
  R_50:  { market: "synthetic_index", submarket: "random_index" },
  R_75:  { market: "synthetic_index", submarket: "random_index" },
  R_100: { market: "synthetic_index", submarket: "random_index" },
  "1HZ10V":  { market: "synthetic_index", submarket: "random_index" },
  "1HZ25V":  { market: "synthetic_index", submarket: "random_index" },
  "1HZ50V":  { market: "synthetic_index", submarket: "random_index" },
  "1HZ75V":  { market: "synthetic_index", submarket: "random_index" },
  "1HZ100V": { market: "synthetic_index", submarket: "random_index" },
  BOOM500:   { market: "synthetic_index", submarket: "crash_index" },
  BOOM1000:  { market: "synthetic_index", submarket: "crash_index" },
  CRASH500:  { market: "synthetic_index", submarket: "crash_index" },
  CRASH1000: { market: "synthetic_index", submarket: "crash_index" },
};

export function buildDbotMatchXml({
  market, digit, stake, durationTicks = 1,
}: DbotTemplateInput): string {
  const sym = SYMBOL_TO_DBOT[market];
  const grp = MARKET_GROUP[market];
  const safeDigit = Math.max(0, Math.min(9, Math.round(digit)));
  const safeStake = Math.max(0.35, Number(stake.toFixed(2)));

  return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="vStake">stake</variable>
    <variable id="vDigit">prediction</variable>
  </variables>
  <block type="trade_definition" id="trade_def" deletable="false" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="tdm" deletable="false" movable="false">
        <field name="MARKET_LIST">${grp.market}</field>
        <field name="SUBMARKET_LIST">${grp.submarket}</field>
        <field name="SYMBOL_LIST">${sym}</field>
        <next>
          <block type="trade_definition_tradetype" id="tdt" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">matchesdiffers</field>
            <next>
              <block type="trade_definition_contracttype" id="tdc" deletable="false" movable="false">
                <field name="TYPE_LIST">DIGITMATCH</field>
                <next>
                  <block type="trade_definition_candleinterval" id="tdi" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="tdr" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="tdre" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="variables_set" id="set_stake">
        <field name="VAR" id="vStake">stake</field>
        <value name="VALUE"><block type="math_number"><field name="NUM">${safeStake}</field></block></value>
        <next>
          <block type="variables_set" id="set_digit">
            <field name="VAR" id="vDigit">prediction</field>
            <value name="VALUE"><block type="math_number"><field name="NUM">${safeDigit}</field></block></value>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION">
      <block type="trade_definition_tradeoptions" id="tdo">
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="CURRENCY_LIST">USD</field>
        <value name="DURATION"><shadow type="math_number"><field name="NUM">${durationTicks}</field></shadow></value>
        <value name="AMOUNT">
          <shadow type="math_number"><field name="NUM">${safeStake}</field></shadow>
          <block type="variables_get"><field name="VAR" id="vStake">stake</field></block>
        </value>
        <value name="PREDICTION">
          <shadow type="math_number_positive"><field name="NUM">${safeDigit}</field></shadow>
          <block type="variables_get"><field name="VAR" id="vDigit">prediction</field></block>
        </value>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="bp" deletable="false" x="0" y="420">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase" id="pur">
        <field name="PURCHASE_LIST">DIGITMATCH</field>
      </block>
    </statement>
  </block>
  <block type="after_purchase" id="ap" deletable="false" x="0" y="640">
    <statement name="AFTERPURCHASE_STACK">
      <block type="trade_again" id="ta"></block>
    </statement>
  </block>
</xml>`;
}

/** Trigger a browser download of the generated XML. Returns the filename. */
export function downloadDbotXml(input: DbotTemplateInput): string {
  const xml = buildDbotMatchXml(input);
  const filename = `match_${input.market}_d${input.digit}.xml`;
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}

export const DBOT_URL = "https://dbot.deriv.com/";


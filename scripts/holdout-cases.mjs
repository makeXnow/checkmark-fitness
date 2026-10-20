/**
 * Holdout set: varied diets the macro pipeline was NOT tuned on. Run as a brand-new user
 * (no library, history, or vocabulary). Ranges come from brand labels / USDA reference values.
 *
 *   AUDIT_SET=holdout node scripts/test-audit-failures.mjs
 */
const one = (re, cal) => [{ item: re, cal, before: '' }]

export const HOLDOUT_CASES = [
  // Plain whole foods (cooked state, lean defaults, size words)
  { id: 'h-salmon-6oz', said: 'Six ounces of baked salmon.', targets: one(/salmon/i, [230, 360]) },
  { id: 'h-chicken-thigh', said: '4 ounces of grilled chicken thigh', targets: one(/thigh|chicken/i, [190, 260]) },
  { id: 'h-sirloin', said: 'I had an 8 ounce grilled sirloin steak', targets: one(/sirloin|steak/i, [400, 600]) },
  { id: 'h-ground-turkey', said: '5 ounces of cooked 93% lean ground turkey', targets: one(/turkey/i, [260, 340]) },
  { id: 'h-shrimp', said: '3 ounces of shrimp', targets: one(/shrimp/i, [70, 115]) },
  { id: 'h-tofu', said: '200 grams of extra firm tofu', targets: one(/tofu/i, [140, 300]) },
  { id: 'h-brown-rice', said: 'a cup of brown rice', targets: one(/rice/i, [200, 260]) },
  { id: 'h-quinoa', said: 'one cup of cooked quinoa', targets: one(/quinoa/i, [200, 240]) },
  { id: 'h-lentils', said: 'a cup of cooked lentils', targets: one(/lentil/i, [200, 250]) },
  { id: 'h-black-beans', said: 'a cup of black beans', targets: one(/bean/i, [190, 250]) },
  { id: 'h-edamame', said: 'one cup of shelled edamame', targets: one(/edamame/i, [170, 230]) },
  { id: 'h-banana', said: 'a medium banana', targets: one(/banana/i, [95, 120]) },
  { id: 'h-large-apple', said: 'a large apple', targets: one(/apple/i, [100, 135]) },
  { id: 'h-avocado-half', said: 'half an avocado', targets: one(/avocado/i, [100, 170]) },
  { id: 'h-sweet-potato', said: 'a medium baked sweet potato', targets: one(/potato/i, [90, 140]) },
  { id: 'h-eggs-boiled', said: 'two large hard boiled eggs', targets: one(/egg/i, [140, 165]) },
  { id: 'h-eggs-scrambled', said: 'two scrambled eggs', targets: one(/egg/i, [140, 230]) },
  { id: 'h-bacon', said: '3 slices of bacon', targets: one(/bacon/i, [100, 170]) },
  { id: 'h-oatmeal', said: 'oatmeal made with half a cup of oats and water', expectItems: 1, targets: one(/oat/i, [140, 175]) },
  { id: 'h-olive-oil', said: 'a tablespoon of olive oil', targets: one(/oil/i, [110, 130]) },
  { id: 'h-pb', said: '2 tablespoons of peanut butter', targets: one(/peanut/i, [180, 210]) },
  { id: 'h-almonds', said: 'a handful of almonds', targets: one(/almond/i, [120, 220]) },
  { id: 'h-milk', said: 'an 8 ounce glass of whole milk', targets: one(/milk/i, [140, 160]) },
  { id: 'h-cottage', said: 'a cup of 2% cottage cheese', targets: one(/cottage/i, [160, 220]) },
  { id: 'h-tuna-can', said: 'a can of tuna in water', targets: one(/tuna/i, [90, 160]) },

  // Branded / packaged (including the confusing brand names)
  { id: 'h-clif', said: 'a Clif Bar chocolate chip', targets: one(/clif|bar/i, [230, 260]) },
  { id: 'h-quest', said: 'a Quest bar cookies and cream', targets: one(/quest|bar/i, [180, 210]) },
  { id: 'h-pure-protein', said: 'a Pure Protein bar chocolate peanut butter', targets: one(/protein|bar/i, [190, 210]) },
  { id: 'h-one-bar', said: 'a ONE bar birthday cake', targets: one(/one|bar|birthday/i, [210, 230]) },
  { id: 'h-premier', said: 'a chocolate Premier Protein shake', targets: one(/premier|shake/i, [150, 170]) },
  { id: 'h-kind', said: 'a KIND bar dark chocolate nuts and sea salt', targets: one(/kind|bar/i, [170, 200]) },
  { id: 'h-fage', said: 'a cup of Fage 0% plain Greek yogurt', targets: one(/yogurt|fage/i, [105, 140]) },
  { id: 'h-daves', said: "two slices of Dave's Killer Bread 21 Whole Grains", targets: one(/bread/i, [210, 240]) },
  { id: 'h-beyond', said: 'one Beyond Burger patty', targets: one(/beyond|burger|patty/i, [220, 290]) },
  { id: 'h-gatorade', said: 'a 20 ounce lemon lime Gatorade', targets: one(/gatorade/i, [130, 150]) },
  { id: 'h-coke-zero', said: 'a can of Coke Zero', targets: one(/coke/i, [0, 5]) },

  // Restaurants
  { id: 'h-starbucks-latte', said: 'a grande latte from Starbucks with 2% milk', targets: one(/latte/i, [170, 210]) },
  { id: 'h-bigmac-fries', said: 'a Big Mac and a medium fries', expectItems: 2, sum: { cal: [820, 1000], before: '' } },
  { id: 'h-chipotle', said: 'Chipotle bowl with chicken, white rice, black beans, fajita veggies, mild salsa and cheese', sum: { cal: [580, 780], before: '' } },
  { id: 'h-dominos', said: "one slice of large hand tossed pepperoni pizza from Domino's", targets: one(/pizza/i, [270, 360]) },
  { id: 'h-pho', said: 'a bowl of beef pho from a restaurant', sum: { cal: [350, 800], before: '' } },

  // Home-cooked mixed meals and other cuisines
  { id: 'h-dal-roti', said: 'a cup of dal and two rotis', expectItems: 2, sum: { cal: [300, 600], before: '' } },
  { id: 'h-curry-rice', said: 'a cup of white rice and a cup of chicken curry', expectItems: 2, sum: { cal: [420, 650], before: '' } },
  { id: 'h-tacos', said: 'two corn tortillas with about 4 ounces of carne asada', expectItems: 2, sum: { cal: [320, 470], before: '' } },
  { id: 'h-bagel', said: 'a plain bagel with cream cheese', sum: { cal: [320, 480], before: '' } },
  { id: 'h-sandwich-apple', said: 'a turkey sandwich on whole wheat with mayo and an apple', sum: { cal: [400, 700], before: '' } },

  // Not a consumption report
  { id: 'h-non-food', said: 'I went grocery shopping and bought chicken and rice for the week', expectItems: 0, sum: { cal: [0, 0], before: '' } },
]

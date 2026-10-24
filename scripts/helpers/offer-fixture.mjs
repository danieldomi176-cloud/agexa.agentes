/** Fictional offer evidence for isolated regression servers, never operational data. */
export async function confirmFixtureOffer(api, knowledge) {
  await api('knowledge', { ...knowledge, trialAvailable: false });
  await api('readiness/offer', {
    registrationEvidence: 'SIMULAÇÃO: cadastro fictício isolado com sete dias de teste.',
    startsWhen: 'SIMULAÇÃO: começa na criação confirmada da conta de teste.',
    expiryBehaviour: 'SIMULAÇÃO: bloqueia funções no fim sem pagamento confirmado.',
    paymentRequired: true,
    includedFeatures: 'SIMULAÇÃO: apenas as funcionalidades de fixture guardadas.',
    confirmed: true,
  });
  return api('knowledge', knowledge);
}

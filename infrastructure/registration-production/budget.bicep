// Subscription-scope review-only budget. Deploy separately after recipient approval.
targetScope = 'subscription'
@description('Resource group containing production registration resources.')
param resourceGroupName string
@description('Budget start date, first day of a future month in YYYY-MM-01 form.')
param startDate string
@description('Small monthly production registration budget in billing currency.')
param monthlyAmount int = 10
@secure()
@description('Alert addresses supplied manually in an addresses array and never committed.')
param contactDetails object

resource registrationBudget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'budget-blorenge-registration-production'
  properties: {
    amount: monthlyAmount
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: { startDate: startDate }
    filter: { dimensions: { name: 'ResourceGroupName', operator: 'In', values: [resourceGroupName] } }
    notifications: {
      Actual50: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 50, contactEmails: contactDetails.addresses }
      Actual80: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 80, contactEmails: contactDetails.addresses }
      Actual100: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 100, contactEmails: contactDetails.addresses }
    }
  }
}

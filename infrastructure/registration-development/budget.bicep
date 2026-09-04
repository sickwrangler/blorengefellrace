// REVIEW ONLY. Deploy separately because budget support and permissions vary by subscription.
targetScope = 'resourceGroup'

param budgetName string = 'budget-blorenge-registration-dev-gbp1'
param amount int = 1

@description('First day of the deployment month, for example 2026-09-01T00:00:00Z.')
param startDate string

@description('A future first-of-month date, for example 2030-09-01T00:00:00Z.')
param endDate string

@secure()
@description('Notification address supplied at deployment time; never commit it.')
param alertEmail string

resource developmentBudget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: budgetName
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
      endDate: endDate
    }
    notifications: {
      Actual_GreaterThanOrEqualTo_50_Percent: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: [alertEmail]
        contactGroups: []
        contactRoles: []
      }
      Actual_GreaterThanOrEqualTo_100_Percent: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [alertEmail]
        contactGroups: []
        contactRoles: []
      }
    }
  }
}

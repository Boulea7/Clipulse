export { bootstrapDashboard, createDashboardApp } from './dashboard.js'
export { renderMetricList, renderSectionTitle } from './dom.js'
export { formatDuration, formatTimestampLabel } from './formatters.js'
export {
  buildHomeHash,
  buildProjectHash,
  buildProvidersHash,
  buildReportsHash,
  buildSessionHash,
  buildSettingsHash,
  parseDashboardHash,
} from './routes.js'
export {
  buildDetailEntries,
  buildOverviewLines,
  buildProjectListItems,
  buildRecentSessionItems,
  buildTimeseriesRows,
} from './view-models.js'

import { bootstrapDashboard } from './dashboard.js'

void bootstrapDashboard()

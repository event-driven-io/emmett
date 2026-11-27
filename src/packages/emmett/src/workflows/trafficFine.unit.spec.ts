import { describe, it } from 'vitest';
import { WorkflowSpecification } from '../testing/workflowSpecification';
import {
  IssueTrafficFineWorkflow,
  type PoliceReportPublished,
} from './trafficFine.testHelpers';

const publishedAt = new Date('2026-03-19T10:00:00Z');

const speedingReport: PoliceReportPublished = {
  type: 'PoliceReportPublished',
  data: {
    policeReportId: 'XG.96.L1.5000267/2026',
    offense: {
      offenseType: 'SpeedingViolation',
      maximumSpeedKmh: 50,
      recordedSpeedKmh: 71,
    },
    publishedAt,
  },
};

const given = WorkflowSpecification.for(IssueTrafficFineWorkflow);

void describe('IssueTrafficFine workflow', () => {
  void describe('PoliceReportPublished', () => {
    void it('asks for a system number when the report is a speeding violation', () => {
      // #region traffic-fine-test-start
      given([])
        .when(speedingReport)
        .then({
          type: 'GenerateTrafficFineSystemNumber',
          data: { policeReportId: 'XG.96.L1.5000267/2026' },
        });
      // #endregion traffic-fine-test-start
    });

    void it('produces nothing when the report is not a speeding violation', () => {
      // #region traffic-fine-test-parking
      given([])
        .when({
          type: 'PoliceReportPublished',
          data: {
            policeReportId: 'XG.96.L1.5000268/2026',
            offense: { offenseType: 'ParkingViolation' },
            publishedAt,
          },
        })
        .thenNothingHappened();
      // #endregion traffic-fine-test-parking
    });

    void it('produces nothing when the report was already published', () => {
      given([speedingReport]).when(speedingReport).thenNothingHappened();
    });
  });

  void describe('TrafficFineSystemNumberGenerated', () => {
    void it('asks for a manual identification code', () => {
      given([speedingReport])
        .when({
          type: 'TrafficFineSystemNumberGenerated',
          data: {
            policeReportId: 'XG.96.L1.5000267/2026',
            systemNumber: 'PPXRG/26TV8457',
          },
        })
        .then({
          type: 'GenerateTrafficFineManualIdentificationCode',
          data: {
            policeReportId: 'XG.96.L1.5000267/2026',
            systemNumber: 'PPXRG/26TV8457',
          },
        });
    });

    void it('produces nothing when no system number was asked for', () => {
      given([])
        .when({
          type: 'TrafficFineSystemNumberGenerated',
          data: {
            policeReportId: 'XG.96.L1.5000267/2026',
            systemNumber: 'PPXRG/26TV8457',
          },
        })
        .thenNothingHappened();
    });
  });

  void describe('TrafficFineManualIdentificationCodeGenerated', () => {
    void it('issues the fine with everything gathered along the way', () => {
      // #region traffic-fine-test-issue
      given([
        speedingReport,
        {
          type: 'TrafficFineSystemNumberGenerated',
          data: {
            policeReportId: 'XG.96.L1.5000267/2026',
            systemNumber: 'PPXRG/26TV8457',
          },
        },
      ])
        .when({
          type: 'TrafficFineManualIdentificationCodeGenerated',
          data: {
            policeReportId: 'XG.96.L1.5000267/2026',
            manualIdentificationCode: 'XMfhyM',
          },
        })
        .then({
          type: 'IssueTrafficFine',
          data: {
            policeReportId: 'XG.96.L1.5000267/2026',
            systemNumber: 'PPXRG/26TV8457',
            manualIdentificationCode: 'XMfhyM',
          },
        });
      // #endregion traffic-fine-test-issue
    });

    void it('produces nothing when the code arrives before the system number', () => {
      given([speedingReport])
        .when({
          type: 'TrafficFineManualIdentificationCodeGenerated',
          data: {
            policeReportId: 'XG.96.L1.5000267/2026',
            manualIdentificationCode: 'XMfhyM',
          },
        })
        .thenNothingHappened();
    });
  });
});

import type { Command } from '../typing/command';
import type { Event } from '../typing/event';
import type { Workflow, WorkflowEvent, WorkflowOutput } from './workflow';
import type { WorkflowOptions } from './workflowProcessor';

/// The workflow Yves Reynhout uses in https://blog.bittacklr.be/the-workflow-pattern.html,
/// expressed with Emmett's abstractions. A police report that reports a speeding
/// violation has to cause a traffic fine to be issued, which needs a system
/// number and a manual identification code generated first, one after the other.

////////////////////////////////////////////
////////// Inputs
///////////////////////////////////////////

export type Offense =
  | {
      offenseType: 'SpeedingViolation';
      maximumSpeedKmh: number;
      recordedSpeedKmh: number;
    }
  | { offenseType: 'ParkingViolation' };

export type PoliceReportPublished = Event<
  'PoliceReportPublished',
  {
    policeReportId: string;
    offense: Offense;
    publishedAt: Date;
  }
>;

export type TrafficFineSystemNumberGenerated = Event<
  'TrafficFineSystemNumberGenerated',
  {
    policeReportId: string;
    systemNumber: string;
  }
>;

export type TrafficFineManualIdentificationCodeGenerated = Event<
  'TrafficFineManualIdentificationCodeGenerated',
  {
    policeReportId: string;
    manualIdentificationCode: string;
  }
>;

////////////////////////////////////////////
////////// Outputs
///////////////////////////////////////////

export type GenerateTrafficFineSystemNumber = Command<
  'GenerateTrafficFineSystemNumber',
  { policeReportId: string }
>;

export type GenerateTrafficFineManualIdentificationCode = Command<
  'GenerateTrafficFineManualIdentificationCode',
  { policeReportId: string; systemNumber: string }
>;

export type IssueTrafficFine = Command<
  'IssueTrafficFine',
  {
    policeReportId: string;
    systemNumber: string;
    manualIdentificationCode: string;
  }
>;

// #region traffic-fine-messages
export type TrafficFineInput =
  | PoliceReportPublished
  | TrafficFineSystemNumberGenerated
  | TrafficFineManualIdentificationCodeGenerated;

export type TrafficFineOutput =
  | GenerateTrafficFineSystemNumber
  | GenerateTrafficFineManualIdentificationCode
  | IssueTrafficFine;
// #endregion traffic-fine-messages

////////////////////////////////////////////
////////// State
///////////////////////////////////////////

// #region traffic-fine-state
export type TrafficFine =
  | { status: 'NotExisting' }
  | { status: 'AwaitingSystemNumber'; policeReportId: string }
  | {
      status: 'AwaitingManualIdentificationCode';
      policeReportId: string;
      systemNumber: string;
    }
  | { status: 'Finished' };

export const initialState = (): TrafficFine => ({ status: 'NotExisting' });
// #endregion traffic-fine-state

////////////////////////////////////////////
////////// Evolve
///////////////////////////////////////////

// #region traffic-fine-evolve
export const evolve = (
  state: TrafficFine,
  { type, data }: WorkflowEvent<TrafficFineInput | TrafficFineOutput>,
): TrafficFine => {
  switch (type) {
    case 'PoliceReportPublished': {
      if (state.status !== 'NotExisting') return state;

      return data.offense.offenseType === 'SpeedingViolation'
        ? {
            status: 'AwaitingSystemNumber',
            policeReportId: data.policeReportId,
          }
        : { status: 'Finished' };
    }
    case 'TrafficFineSystemNumberGenerated': {
      if (state.status !== 'AwaitingSystemNumber') return state;

      return {
        status: 'AwaitingManualIdentificationCode',
        policeReportId: state.policeReportId,
        systemNumber: data.systemNumber,
      };
    }
    case 'TrafficFineManualIdentificationCodeGenerated': {
      if (state.status !== 'AwaitingManualIdentificationCode') return state;

      return { status: 'Finished' };
    }
    default: {
      const _notExistingEventType: never = type;
      return state;
    }
  }
};
// #endregion traffic-fine-evolve

////////////////////////////////////////////
////////// Decide
///////////////////////////////////////////

// #region traffic-fine-decide
export const decide = (
  input: TrafficFineInput,
  state: TrafficFine,
): WorkflowOutput<TrafficFineOutput> => {
  switch (input.type) {
    case 'PoliceReportPublished':
      return reportPublished(input, state);
    case 'TrafficFineSystemNumberGenerated':
      return systemNumberGenerated(input, state);
    case 'TrafficFineManualIdentificationCodeGenerated':
      return manualIdentificationCodeGenerated(input, state);
  }
};
// #endregion traffic-fine-decide

// #region traffic-fine-report-published
const reportPublished = (
  { data }: PoliceReportPublished,
  state: TrafficFine,
): GenerateTrafficFineSystemNumber | [] => {
  if (state.status !== 'NotExisting') return [];

  if (data.offense.offenseType !== 'SpeedingViolation') return [];

  return {
    type: 'GenerateTrafficFineSystemNumber',
    data: { policeReportId: data.policeReportId },
  };
};
// #endregion traffic-fine-report-published

// #region traffic-fine-continue
const systemNumberGenerated = (
  { data }: TrafficFineSystemNumberGenerated,
  state: TrafficFine,
): GenerateTrafficFineManualIdentificationCode | [] => {
  if (state.status !== 'AwaitingSystemNumber') return [];

  return {
    type: 'GenerateTrafficFineManualIdentificationCode',
    data: {
      policeReportId: state.policeReportId,
      systemNumber: data.systemNumber,
    },
  };
};

const manualIdentificationCodeGenerated = (
  { data }: TrafficFineManualIdentificationCodeGenerated,
  state: TrafficFine,
): IssueTrafficFine | [] => {
  if (state.status !== 'AwaitingManualIdentificationCode') return [];

  return {
    type: 'IssueTrafficFine',
    data: {
      policeReportId: state.policeReportId,
      systemNumber: state.systemNumber,
      manualIdentificationCode: data.manualIdentificationCode,
    },
  };
};
// #endregion traffic-fine-continue

////////////////////////////////////////////
////////// Workflow Definition
///////////////////////////////////////////

// #region traffic-fine-definition
export const IssueTrafficFineWorkflow: Workflow<
  TrafficFineInput,
  TrafficFine,
  TrafficFineOutput,
  'IssueTrafficFineWorkflow'
> = {
  name: 'IssueTrafficFineWorkflow',
  decide,
  evolve,
  initialState,
};
// #endregion traffic-fine-definition

// #region traffic-fine-options
export const trafficFineWorkflowOptions: WorkflowOptions<
  TrafficFineInput,
  TrafficFine,
  TrafficFineOutput
> = {
  workflow: IssueTrafficFineWorkflow,
  getWorkflowId: (input) => input.data.policeReportId,
  inputs: {
    commands: [],
    events: [
      'PoliceReportPublished',
      'TrafficFineSystemNumberGenerated',
      'TrafficFineManualIdentificationCodeGenerated',
    ],
  },
  outputs: {
    commands: [
      'GenerateTrafficFineSystemNumber',
      'GenerateTrafficFineManualIdentificationCode',
      'IssueTrafficFine',
    ],
    events: [],
  },
};
// #endregion traffic-fine-options

/* eslint-disable */
// @generated by protobuf-ts 2.8.2 with parameter output_javascript,optimize_code_size,long_type_string,add_pb_suffix,ts_nocheck,eslint_disable
// @generated from protobuf file "runme/runner/v1/runner.proto" (package "runme.runner.v1", syntax proto3)
// tslint:disable
// @ts-nocheck
/* eslint-disable */
// @generated by protobuf-ts 2.8.2 with parameter output_javascript,optimize_code_size,long_type_string,add_pb_suffix,ts_nocheck,eslint_disable
// @generated from protobuf file "runme/runner/v1/runner.proto" (package "runme.runner.v1", syntax proto3)
// tslint:disable
// @ts-nocheck
import { ServiceType } from "@protobuf-ts/runtime-rpc";
import { MessageType } from "@protobuf-ts/runtime";
import { UInt32Value } from "../../../google/protobuf/wrappers_pb";
import { Duration } from "../../../google/protobuf/duration_pb";
// @generated message type with reflection information, may provide speed optimized methods
class Session$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.Session", [
            { no: 1, name: "id", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
            { no: 2, name: "envs", kind: "scalar", repeat: 2 /*RepeatType.UNPACKED*/, T: 9 /*ScalarType.STRING*/ },
            { no: 3, name: "metadata", kind: "map", K: 9 /*ScalarType.STRING*/, V: { kind: "scalar", T: 9 /*ScalarType.STRING*/ } }
        ]);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.Session
 */
export const Session = new Session$Type();
// @generated message type with reflection information, may provide speed optimized methods
class CreateSessionRequest$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.CreateSessionRequest", [
            { no: 1, name: "metadata", kind: "map", K: 9 /*ScalarType.STRING*/, V: { kind: "scalar", T: 9 /*ScalarType.STRING*/ } },
            { no: 2, name: "envs", kind: "scalar", repeat: 2 /*RepeatType.UNPACKED*/, T: 9 /*ScalarType.STRING*/ }
        ]);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.CreateSessionRequest
 */
export const CreateSessionRequest = new CreateSessionRequest$Type();
// @generated message type with reflection information, may provide speed optimized methods
class CreateSessionResponse$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.CreateSessionResponse", [
            { no: 1, name: "session", kind: "message", T: () => Session }
        ]);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.CreateSessionResponse
 */
export const CreateSessionResponse = new CreateSessionResponse$Type();
// @generated message type with reflection information, may provide speed optimized methods
class GetSessionRequest$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.GetSessionRequest", [
            { no: 1, name: "id", kind: "scalar", T: 9 /*ScalarType.STRING*/ }
        ]);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.GetSessionRequest
 */
export const GetSessionRequest = new GetSessionRequest$Type();
// @generated message type with reflection information, may provide speed optimized methods
class GetSessionResponse$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.GetSessionResponse", [
            { no: 1, name: "session", kind: "message", T: () => Session }
        ]);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.GetSessionResponse
 */
export const GetSessionResponse = new GetSessionResponse$Type();
// @generated message type with reflection information, may provide speed optimized methods
class ListSessionsRequest$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.ListSessionsRequest", []);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.ListSessionsRequest
 */
export const ListSessionsRequest = new ListSessionsRequest$Type();
// @generated message type with reflection information, may provide speed optimized methods
class ListSessionsResponse$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.ListSessionsResponse", [
            { no: 1, name: "sessions", kind: "message", repeat: 1 /*RepeatType.PACKED*/, T: () => Session }
        ]);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.ListSessionsResponse
 */
export const ListSessionsResponse = new ListSessionsResponse$Type();
// @generated message type with reflection information, may provide speed optimized methods
class DeleteSessionRequest$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.DeleteSessionRequest", [
            { no: 1, name: "id", kind: "scalar", T: 9 /*ScalarType.STRING*/ }
        ]);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.DeleteSessionRequest
 */
export const DeleteSessionRequest = new DeleteSessionRequest$Type();
// @generated message type with reflection information, may provide speed optimized methods
class DeleteSessionResponse$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.DeleteSessionResponse", []);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.DeleteSessionResponse
 */
export const DeleteSessionResponse = new DeleteSessionResponse$Type();
// @generated message type with reflection information, may provide speed optimized methods
class ExecuteRequest$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.ExecuteRequest", [
            { no: 1, name: "program_name", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
            { no: 2, name: "arguments", kind: "scalar", repeat: 2 /*RepeatType.UNPACKED*/, T: 9 /*ScalarType.STRING*/ },
            { no: 3, name: "directory", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
            { no: 4, name: "envs", kind: "scalar", repeat: 2 /*RepeatType.UNPACKED*/, T: 9 /*ScalarType.STRING*/ },
            { no: 5, name: "commands", kind: "scalar", repeat: 2 /*RepeatType.UNPACKED*/, T: 9 /*ScalarType.STRING*/ },
            { no: 6, name: "script", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
            { no: 7, name: "tty", kind: "scalar", T: 8 /*ScalarType.BOOL*/ },
            { no: 8, name: "background", kind: "scalar", T: 8 /*ScalarType.BOOL*/ },
            { no: 9, name: "chunk_interval", kind: "message", T: () => Duration },
            { no: 10, name: "input_data", kind: "scalar", T: 12 /*ScalarType.BYTES*/ },
            { no: 20, name: "session_id", kind: "scalar", T: 9 /*ScalarType.STRING*/ }
        ]);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.ExecuteRequest
 */
export const ExecuteRequest = new ExecuteRequest$Type();
// @generated message type with reflection information, may provide speed optimized methods
class ExecuteResponse$Type extends MessageType {
    constructor() {
        super("runme.runner.v1.ExecuteResponse", [
            { no: 1, name: "exit_code", kind: "message", T: () => UInt32Value },
            { no: 2, name: "stdout_data", kind: "scalar", T: 12 /*ScalarType.BYTES*/ },
            { no: 3, name: "stderr_data", kind: "scalar", T: 12 /*ScalarType.BYTES*/ }
        ]);
    }
}
/**
 * @generated MessageType for protobuf message runme.runner.v1.ExecuteResponse
 */
export const ExecuteResponse = new ExecuteResponse$Type();
/**
 * @generated ServiceType for protobuf service runme.runner.v1.RunnerService
 */
export const RunnerService = new ServiceType("runme.runner.v1.RunnerService", [
    { name: "CreateSession", options: {}, I: CreateSessionRequest, O: CreateSessionResponse },
    { name: "GetSession", options: {}, I: GetSessionRequest, O: GetSessionResponse },
    { name: "ListSessions", options: {}, I: ListSessionsRequest, O: ListSessionsResponse },
    { name: "DeleteSession", options: {}, I: DeleteSessionRequest, O: DeleteSessionResponse },
    { name: "Execute", serverStreaming: true, clientStreaming: true, options: {}, I: ExecuteRequest, O: ExecuteResponse }
]);

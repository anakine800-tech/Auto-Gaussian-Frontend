export type Displacement={center:number;atomic_number:number;dx:number;dy:number;dz:number};
export type VibrationMode={sorted_mode_index?:number;source_mode_index?:number;mode_number:number;frequency_index:number;block_index:number;column_index:number;frequency_cm1:number;displacements:Displacement[]};
export type ModeProvenance={log_name?:string;log_sha256?:string;orientation?:string};

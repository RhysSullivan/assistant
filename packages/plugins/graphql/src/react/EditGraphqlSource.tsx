export default function EditGraphqlSource(props: {
  sourceId: string;
  onSave: () => void;
}) {
  return (
    <div>
      <h3>Edit GraphQL Source</h3>
      <p>Source: {props.sourceId}</p>
      <button onClick={props.onSave}>Save</button>
    </div>
  );
}
